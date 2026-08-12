// Merging duplicate speaker records into one.
//
// The only destructive write in the CRM, and the only one that deletes a row an organizer did
// not create in this session, so the order below is the whole design:
//
//   1. read the rows involved, UNCACHED;
//   2. give the survivor the union of everybody's event links;
//   3. move the SpeakerTags membership onto the survivor;
//   4. repoint the seven single links to a speaker (mutations-crm-relink.ts);
//   5. delete the absorbed rows;
//   6. expire exactly the tags this touched.
//
// The delete is LAST because nothing else can be undone either. A failure at step 3 leaves two
// records that are still both there and still both findable, which is the state the organizer
// started in; a delete first would leave sessions and files pointing at a record id that no
// longer resolves, and nothing in this product can put that back.
//
// THERE IS NO TRANSACTION, and pretending otherwise would be worse than saying so. Airtable
// has none, so a merge is a sequence of independent requests and any of them can be the last
// one that lands. What the order above buys is a bounded, legible failure state, and it is
// worth writing down because somebody will hit it:
//
//   - A failure at ANY step leaves both records present. Nothing is deleted until every
//     repoint has returned, so the organizer can look at both rows and press Merge again.
//   - The merge is RE-RUNNABLE, which is what makes that the right answer. Every step is
//     idempotent against a partial result: the event union is recomputed from the rows, a
//     tag already moved is already `[primary]` and produces no patch, a participant row
//     already repointed no longer names an absorbed id, and a repointed link is a no-op the
//     second time. Re-running after a failure completes the merge; it does not double it.
//   - What a half-finished merge DOES leave is links moved onto the survivor while the
//     absorbed record still exists. That record then looks emptier than it was - a duplicate
//     with no sessions rather than a duplicate with two - and the numbers in the directory
//     will disagree with what the organizer saw before pressing the button. That is the
//     honest cost of not having a transaction, and it is recoverable by re-running.
//   - Step 6 runs in a `finally`, so those moved links are never left behind a cache entry
//     that predates them.
//
// `tests/crm-merge-orchestration.test.ts` pins all of the above against an in-memory base:
// the delete follows every other write in the call log, each repointed table is asserted
// separately so dropping one fails, and a failure injected at either end of the sequence
// leaves both records present and is completed by a re-run.
//
// The survivor is an EXISTING record, not a new one written from merged fields. That is what
// makes "keeps the primary's identity fields" free: the id survives, so `/admin/crm/{id}`,
// every link already pointing at it and its revision history all stay valid, and no field on
// it is written at all except the event links it gains.
//
// AUTHORIZATION IS NOT HERE. `mergeSpeakersAction` (features/crm/merge-actions.ts) resolves
// the caller's scope and checks every id against it before calling this, the same division
// `deleteSpeakerList` documents: a caller that has not done that has a bug in the action.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { AirtableClient } from '@/services/airtable/client'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { speakerTagSpeakerIds } from '@/services/airtable/mapping-crm'
import {
  type RelinkCount,
  relinkParticipants,
  relinkSpeakerTable,
  SPEAKER_LINK_TABLES,
} from '@/services/airtable/mutations-crm-relink'
import { type AirtableRecord, linkIds, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventOutboxTag,
  eventSpeakersTag,
  eventSubmissionsTag,
  speakerCommsTag,
  speakerFileRequestsTag,
  speakerFilesTag,
  speakerNotesTag,
  speakerStageHistoryTag,
  speakerTag,
  speakerTagsTag,
  speakerTasksTag,
  submissionTag,
} from '@/services/airtable/tags'
import type { RecordId } from '@/types/domain'

export type SpeakerMergeInput = {
  readonly primaryId: RecordId
  /** Never empty, and never containing `primaryId`. `checkMerge` guarantees both. */
  readonly absorbedIds: readonly RecordId[]
}

export type SpeakerMergeResult = {
  readonly primaryId: RecordId
  readonly absorbed: number
  /** Cast rows moved to the survivor, and rows dropped because it was already cast. */
  readonly sessionsMoved: number
  readonly sessionsDeduplicated: number
  readonly tagsMoved: number
}

export async function mergeSpeakers(
  origin: WriteOrigin,
  input: SpeakerMergeInput,
): Promise<SpeakerMergeResult> {
  const client = getClient()
  const absorbed = new Set(input.absorbedIds)
  // Read before the `try`, so a record that has vanished since the action checked its scope
  // throws with nothing written at all rather than from inside a half-finished merge.
  const eventIds = unionEvents(await speakerRows(client, [input.primaryId, ...input.absorbedIds]))
  // Filled as rows move, and read by the `finally` below even on a failure, because a row that
  // moved before the failure still has to be expired. See `relinkedTags`.
  const relinked: RelinkCount[] = []

  try {
    await setEvents(client, input.primaryId, eventIds)
    const tagsMoved = await moveTagMembership(client, absorbed, input.primaryId)
    const sessions = await relinkParticipants(client, absorbed, input.primaryId)
    const target = { absorbed, primaryId: input.primaryId }
    for (const link of SPEAKER_LINK_TABLES) {
      await relinkSpeakerTable(client, link, target, (planned) => relinked.push(planned))
    }
    await client.deleteRecords(TABLES.speakers, input.absorbedIds)

    return {
      primaryId: input.primaryId,
      absorbed: absorbed.size,
      sessionsMoved: sessions.repointed,
      sessionsDeduplicated: sessions.removed,
      tagsMoved,
    }
  } finally {
    // In a `finally`, for the reason `setSpeakerTags` gives: a merge is many requests, and a
    // failure halfway through has still moved rows. Leaving those uninvalidated would serve
    // the directory a snapshot from before a change that did happen. `finally` does not
    // catch, so the failure still reaches the action.
    invalidate(origin, {
      own: [...mergeTags(input, eventIds), ...relinkedTags(relinked)],
    })
  }
}

/**
 * Every event any of these records is on, read UNCACHED.
 *
 * Uncached is load-bearing rather than habitual: the CRM's own roster read intersects each
 * speaker's events with the VIEWER'S scope (`listSpeakersInEvents`), so building this union
 * from the directory's rows would write back a set with the caller's non-member events
 * removed and silently unlink the survivor from an event it was on. This reads the rows
 * themselves, so the union is the whole truth about all of them.
 *
 * One `listAll` rather than a `getRecord` per id, and the reason is the delete at the end.
 * A `getRecord` for a row that has vanished since the action checked its scope throws a 404
 * from inside step 1, which is survivable; the same disappearance reaching step 5 is not,
 * because Airtable's batch delete is all-or-nothing and one dead id would reject the whole
 * delete AFTER every link had been repointed onto the survivor. Reading the set once lets
 * the mismatch be named before anything has been written. It costs one whole-table scan,
 * which is what `moveTagMembership` already spends, on an operation performed by hand.
 */
async function speakerRows(
  client: AirtableClient,
  speakerIds: readonly RecordId[],
): Promise<readonly AirtableRecord[]> {
  const wanted = new Set(speakerIds)
  const found = (await client.listAll(TABLES.speakers)).filter((record) => wanted.has(record.id))
  if (found.length !== wanted.size) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'one of those speaker records no longer exists. Reload and try again.',
    )
  }
  return found
}

/** The union of every event link on those rows, in first-seen order. */
function unionEvents(records: readonly AirtableRecord[]): readonly RecordId[] {
  const events = new Set<RecordId>()
  for (const record of records) {
    for (const eventId of linkIds(view(TABLES.speakers, record), COL.events)) events.add(eventId)
  }
  return [...events]
}

/** The survivor's `events` cell, replaced with the union. The one field a merge writes. */
async function setEvents(
  client: AirtableClient,
  primaryId: RecordId,
  eventIds: readonly RecordId[],
): Promise<void> {
  await client.updateRecords(TABLES.speakers, [
    { id: primaryId, fields: { [COL.events]: [...eventIds] } },
  ])
}

/**
 * Move tag membership onto the survivor.
 *
 * `speakers` on a SpeakerTags row is a MULTI link, so the cell is edited rather than replaced:
 * every other speaker carrying that tag has to stay in it. A tag both records already carried
 * collapses to one entry rather than listing the survivor twice.
 *
 * Read uncached for the reason `setSpeakerTags` gives about the same table: this rewrites a
 * whole `speakers` cell, and deciding its contents from an hour-old cached vocabulary would
 * drop another organizer's concurrent tagging of a speaker this merge never touched.
 */
async function moveTagMembership(
  client: AirtableClient,
  absorbed: ReadonlySet<RecordId>,
  primaryId: RecordId,
): Promise<number> {
  const records = await client.listAll(TABLES.speakerTags)
  const patches = records.flatMap((record) => {
    const current = speakerTagSpeakerIds(record)
    if (!current.some((id) => absorbed.has(id))) return []
    const next = [...new Set(current.map((id) => (absorbed.has(id) ? primaryId : id)))]
    return [{ id: record.id, fields: { [COL.speakers]: next } }]
  })

  if (patches.length > 0) await client.updateRecords(TABLES.speakerTags, patches)
  return patches.length
}

/**
 * Exactly what a merge expires, and nothing wider.
 *
 * Named per record and per event rather than as one CRM-wide sweep, because BUILD_SPEC 6.1
 * treats over-invalidation as a defect: this write must not expire the abstracts table of an
 * event neither record belongs to. What it does have to expire is broad, because a merge
 * genuinely touches nine tables:
 *
 *   - `speaker:{id}` and the four per-speaker feeds for BOTH sides. The absorbed ids are
 *     included even though those records are gone: an entry cached under a dead id would
 *     otherwise keep serving a profile for a person who no longer exists.
 *   - `event:{id}:speakers` for every event in the union, which is what the directory reads.
 *   - `event:{id}:submissions` for the same events, because the cast changed. It is derived
 *     from the events rather than from the participant rows on purpose: a submission carries
 *     no event link this function has read, and reading every submission to find one would
 *     cost a table scan to narrow a tag list that is already this size.
 *
 * `relinkedTags` adds what this cannot see, at row granularity, from the rows actually
 * patched. The division is deliberate: this list is derivable from the INPUT, so it is
 * complete even when a merge fails before writing anything.
 */
/**
 * The tags the repoints themselves earned, at ROW granularity.
 *
 * `mergeTags` below expires per-speaker and per-event entries, and neither reaches a cached
 * SUBMISSION: `getSubmission` caches under `submission:{id}` (reads.ts), which nothing about a
 * speaker names. Repointing `Submissions.submitter` changes exactly that record, so it has to
 * expire that tag, the same way `setPrimaryParticipant` does for the same column.
 *
 * The event ids matter for the case the union cannot cover: a row's event link and a speaker's
 * event links are separate cells with nothing in Airtable coupling them, so a submission whose
 * submitter is being merged can sit on an event neither speaker row names. `mergeTags` derives
 * its event list from the SPEAKERS, so that abstract's list would be left behind a cache entry
 * that predates the change. These come from the rows actually patched.
 *
 * Each table's events map to the tag ITS rows are cached under, which is why this switches
 * rather than expiring `event:{id}:submissions` for every event it sees: EmailOutbox carries
 * an event link too, and reading a comms row's event as a submissions tag would both expire
 * the wrong list and leave the right one stale. The five tables with no `event` column report
 * none, and their rows are covered by the per-speaker feeds `mergeTags` already names.
 */
function relinkedTags(relinked: readonly RelinkCount[]): readonly string[] {
  return relinked.flatMap((entry) => {
    if (entry.table === TABLES.submissions) {
      return [...entry.ids.map(submissionTag), ...entry.eventIds.map(eventSubmissionsTag)]
    }
    if (entry.table === TABLES.emailOutbox) return entry.eventIds.map(eventOutboxTag)
    return []
  })
}

function mergeTags(input: SpeakerMergeInput, eventIds: readonly RecordId[]): readonly string[] {
  const speakerIds = [input.primaryId, ...input.absorbedIds]
  return [
    speakerTagsTag(),
    ...speakerIds.flatMap((id) => [
      speakerTag(id),
      speakerTasksTag(id),
      speakerFilesTag(id),
      speakerFileRequestsTag(id),
      speakerCommsTag(id),
      speakerNotesTag(id),
      speakerStageHistoryTag(id),
    ]),
    ...eventIds.flatMap((id) => [eventSpeakersTag(id), eventSubmissionsTag(id)]),
  ]
}
