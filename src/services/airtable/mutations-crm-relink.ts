// Moving every link that points at an absorbed speaker onto the surviving one.
//
// Split out of `mutations-crm-merge.ts` for the file-size budget, and the seam is real: this
// file knows which tables carry a `speaker` link and how to repoint one, while that one owns
// the speaker row itself, the tag membership, the deletes and the invalidation.
//
// EVERY READ HERE IS UNCACHED, and that is not the usual "a write-path read must not be
// cached" boilerplate - it decides what gets deleted. `listAll` with no `revalidate` is
// `no-store` (read-cache.ts), so a row created a second ago by another organizer is seen and
// repointed rather than being left pointing at a record this function is about to delete.
//
// The tables are enumerated rather than discovered. Airtable's metadata API would answer
// "which columns link to Speakers", but it is a different endpoint with a different scope,
// and a merge that silently skips a table because the token could not read the schema is
// exactly the failure mode this list exists to make impossible: a new table with a `speaker`
// link has to be added here, and that is a visible one-line diff.

import type { AirtableClient, RecordPatch } from '@/services/airtable/client'
import { linkIds, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'

/** One single-link column pointing at Speakers, and the table it sits on. */
export type SpeakerLinkColumn = { readonly table: string; readonly column: string }

/**
 * The single links to a speaker that simply move.
 *
 * Carries the COLUMN as well as the table, because `speaker` is not the only name one of these
 * goes by, and assuming it was is what left `Submissions.submitter` out of this list until
 * 2026-08-11. The consequence was not a stale link: Airtable CLEARS a link cell when the
 * linked record is deleted, `mapSubmission` reads `submitter` with `requiredLink`, and
 * `listSubmissionsForEvents` maps every record in the table before filtering by event. So
 * merging a speaker who had ever submitted anything threw on every submissions read in every
 * event, for good. Exactly the failure the webhook queue hit the same day, on the surface the
 * whole product is built around.
 *
 * The full inventory of columns linking to Speakers, from src/migrations: the seven below, plus
 * `SubmissionParticipants.speaker` and `SpeakerTags.speakers`, which are handled separately.
 * A new one has to be added here, and that is a visible one-line diff.
 *
 * SubmissionParticipants is deliberately NOT here: repointing it can produce two rows casting
 * one person on one session, which is a different operation. See `planParticipantMerge`.
 */
export const SPEAKER_LINK_TABLES: readonly SpeakerLinkColumn[] = [
  { table: TABLES.taskAssignments, column: COL.speaker },
  { table: TABLES.fileRequestAssignments, column: COL.speaker },
  { table: TABLES.files, column: COL.speaker },
  { table: TABLES.emailOutbox, column: COL.speaker },
  // The two cross-event logs about a PERSON. They matter more to a merge than their size
  // suggests: both are append-only history, so a row left pointing at a deleted record is
  // the one kind of data here that cannot be reconstructed from anything else.
  { table: TABLES.speakerNotes, column: COL.speaker },
  { table: TABLES.speakerStageHistory, column: COL.speaker },
  // Who OWNS the abstract, which is a different question from who is cast on it: the cast is
  // SubmissionParticipants above. Repointing is the right answer rather than a special case,
  // because the survivor is the same person the absorbed record was.
  { table: TABLES.submissions, column: COL.submitter },
]

/**
 * What one table's repoint touched, so the merge can report it, expire it, and be asserted.
 *
 * `ids` and `eventIds` are what a caller needs to invalidate at row granularity: the rows that
 * moved, and the events they belong to. `eventIds` is empty for a table with no `event` link,
 * which is most of them.
 */
export type RelinkCount = {
  readonly table: string
  readonly rows: number
  readonly ids: readonly string[]
  readonly eventIds: readonly string[]
}

/** Who is being merged into whom. One parameter because the repoint always needs both. */
export type SpeakerMergeTarget = {
  readonly absorbed: ReadonlySet<string>
  readonly primaryId: string
}

/**
 * Repoint one table's link to a speaker, from any absorbed id to the primary.
 *
 * The absorbed ids are SWAPPED INSIDE the existing cell rather than the cell being replaced
 * with `[primaryId]`, and deduplicated on the way, which is what `moveTagMembership` does to
 * SpeakerTags for the same reason. Every column here is single as the product uses it, but
 * that is a convention rather than a constraint: 001-initial-schema.ts creates every link as
 * `multipleRecordLinks` with no `prefersSingleRecordLink`, so a cell edited in Airtable can
 * genuinely hold two ids, and replacing it would silently drop the one that is not being
 * merged. Swapping costs nothing and cannot lose a link. It also collapses correctly when a
 * cell names both absorbed records, or an absorbed record and the survivor.
 *
 * `report` is called with the count BEFORE the write, and that ordering is the point of it
 * being a callback rather than the return value. `updateRecords` batches at ten, so a table
 * with eleven rows to move is two requests and the second can fail after the first has landed:
 * a caller that only saw the return value would expire nothing for rows that did change. Told
 * first, it expires a superset, which costs a refetch of rows that turned out not to move.
 * Under-expiring costs stale data with nothing to correct it.
 */
export async function relinkSpeakerTable(
  client: AirtableClient,
  { table, column }: SpeakerLinkColumn,
  { absorbed, primaryId }: SpeakerMergeTarget,
  report: (count: RelinkCount) => void,
): Promise<RelinkCount> {
  const records = await client.listAll(table)
  const eventIds = new Set<string>()

  const patches: RecordPatch[] = records.flatMap((record) => {
    const source = view(table, record)
    const current = linkIds(source, column)
    if (!current.some((id) => absorbed.has(id))) return []

    for (const eventId of linkIds(source, COL.event)) eventIds.add(eventId)
    const next = [...new Set(current.map((id) => (absorbed.has(id) ? primaryId : id)))]
    return [{ id: record.id, fields: { [column]: next } }]
  })

  const count: RelinkCount = {
    table,
    rows: patches.length,
    ids: patches.map((patch) => patch.id),
    eventIds: [...eventIds],
  }

  report(count)
  if (patches.length > 0) await client.updateRecords(table, patches)
  return count
}

/** One SubmissionParticipants row, reduced to the three fields the merge reasons about. */
export type ParticipantRow = {
  readonly id: string
  readonly submissionId: string | undefined
  readonly speakerId: string | undefined
  readonly isPrimary: boolean
}

export type ParticipantMergePlan = {
  readonly patches: readonly RecordPatch[]
  /** Rows to delete, because the survivor is already cast on that session. */
  readonly removals: readonly string[]
  /** Rows whose `speaker` moved, excluding the `isPrimary` promotions in `patches`. */
  readonly repointed: number
}

/**
 * What a merge does to the cast, decided without a network so it can be asserted directly.
 *
 * Repointed where the survivor is not already on the session; DELETED where it is, because
 * merging two records that both presented one session must leave one participant row rather
 * than casting the same person twice. `sessionCounts` in speaker-rows.ts already deduplicates
 * a repeated id within a cast, so a double row would not inflate the CRM's own Sessions
 * count - it would inflate everything else: the participant list on the abstract, the speaker
 * chips on the agenda, and the notification fan-out, which sends one email per participant row.
 *
 * `isPrimary` CARRIES OVER on a delete. If the row being removed was the session's primary
 * presenter and the surviving row was not, dropping it would leave a submission whose cast has
 * no primary, and `Submission.submitter` is read off that flag.
 *
 * A row with no `submission` link cannot collide with anything, so it is simply repointed. It
 * should not exist (`mapParticipant` requires the link), but this decides what gets deleted
 * and "cannot happen" is not a safe basis for a delete.
 */
export function planParticipantMerge(
  rows: readonly ParticipantRow[],
  absorbed: ReadonlySet<string>,
  primaryId: string,
): ParticipantMergePlan {
  // Where the survivor already sits, and under which row. Grown as rows are repointed below,
  // so two absorbed records on one session collapse to one row rather than to two.
  const held = new Map<string, ParticipantRow>()
  for (const row of rows) {
    if (row.speakerId === primaryId && row.submissionId !== undefined) {
      held.set(row.submissionId, row)
    }
  }

  const patches: RecordPatch[] = []
  const removals: string[] = []
  const promoted = new Set<string>()

  for (const row of rows) {
    if (row.speakerId === undefined || !absorbed.has(row.speakerId)) continue
    const incumbent = held.get(row.submissionId ?? '')

    if (incumbent === undefined) {
      patches.push({ id: row.id, fields: { [COL.speaker]: [primaryId] } })
      if (row.submissionId !== undefined) {
        held.set(row.submissionId, { ...row, speakerId: primaryId })
      }
      continue
    }

    removals.push(row.id)
    if (row.isPrimary && !incumbent.isPrimary && !promoted.has(incumbent.id)) {
      promoted.add(incumbent.id)
      patches.push({ id: incumbent.id, fields: { [COL.isPrimary]: true } })
    }
  }

  return { patches, removals, repointed: patches.length - promoted.size }
}

/** Read the cast, plan the merge, write it. The IO half of `planParticipantMerge`. */
export async function relinkParticipants(
  client: AirtableClient,
  absorbed: ReadonlySet<string>,
  primaryId: string,
): Promise<{ readonly repointed: number; readonly removed: number }> {
  const table = TABLES.submissionParticipants
  const rows = (await client.listAll(table)).map((record): ParticipantRow => {
    const source = view(table, record)
    return {
      id: record.id,
      submissionId: linkIds(source, COL.submission).at(0),
      speakerId: linkIds(source, COL.speaker).at(0),
      isPrimary: source.get(COL.isPrimary) === true,
    }
  })

  const plan = planParticipantMerge(rows, absorbed, primaryId)
  // Patches before deletes: a promotion has to land while the row it replaces still exists,
  // so a failure between the two leaves a session with two primaries rather than none.
  if (plan.patches.length > 0) await client.updateRecords(table, plan.patches)
  if (plan.removals.length > 0) await client.deleteRecords(table, plan.removals)
  return { repointed: plan.repointed, removed: plan.removals.length }
}
