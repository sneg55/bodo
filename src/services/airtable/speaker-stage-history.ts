// SpeakerStageHistory: the mapper, the read, and the write, in one file.
//
// Same arrangement as `speaker-notes.ts` beside it and `revisions.ts` two directories over,
// and for the same reasons: a table of five columns with no branches, and a boundary
// (`queries.ts`) that exists to resolve a fixture branch this table has nothing to resolve.
//
// Append only. A history somebody can edit answers a different question from the one it is
// asked, which is the argument `revisions.ts` makes at length; this is the same table shape
// applied to a PERSON's pipeline stage rather than to a submission's content.
//
// The writer takes a pre-computed from/to pair rather than reading the speaker itself and
// diffing. `stageChangeDraft` in `features/crm/stage-history.ts` already decided whether a
// move happened, and a second implementation of "did this actually change" would eventually
// disagree with the first, which on an append-only log means rows that record a move that
// never occurred.
//
// Rows are tolerant readers, the rule mapping-comms.ts states: this table is visible in the
// Airtable grid and pressing `+` there creates a blank row.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { type AirtableRecord, optionalLink, optionalText, view } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/table-names'
import { COL } from '@/services/airtable/tables'
import { speakerStageHistoryTag } from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

/**
 * One recorded move through the pipeline.
 *
 * `from` and `to` are plain strings and not `SpeakerStatus`, on purpose. A history row
 * records the vocabulary as it WAS: a status later retired from `SPEAKER_STATUSES` still
 * happened, and typing this to the current closed list would make the mapper throw on the
 * one row that proves it. The surface renders the label when it recognises the value and the
 * stored string when it does not.
 */
export type SpeakerStageChange = {
  id: RecordId
  speakerId: RecordId
  /** Empty when the contact had no stage at all before this move. */
  from: string
  to: string
  /** A name where one is known, else the address. Snapshotted, see the migration. */
  authorName: string
  at: string
}

export function mapSpeakerStageChange(record: AirtableRecord): SpeakerStageChange {
  const source = view(TABLES.speakerStageHistory, record)
  return {
    id: source.id,
    speakerId: optionalLink(source, COL.speaker) ?? '',
    // A move OUT of no stage stores the empty string, and that is a fact rather than a
    // missing value: "no stage to Invited" is exactly what an organizer wants to find.
    from: optionalText(source, COL.previousValue) ?? '',
    to: optionalText(source, COL.newValue) ?? '',
    authorName: optionalText(source, COL.authorName) ?? 'Unknown',
    at: optionalText(source, COL.at) ?? '',
  }
}

/** Tags AND a window together, per the conventions file: either alone is a bug. */
function historyCache(speakerId: RecordId): ReadCache {
  return { tags: [speakerStageHistoryTag(speakerId)], revalidate: REVALIDATE.edited }
}

/**
 * One contact's stage history, newest first, which is how a history is scanned.
 *
 * Filtered in code rather than by formula, the rule at the top of reads.ts: a link field
 * reads back in a formula as the linked record's primary-field text, not its id.
 */
export async function listSpeakerStageChanges(
  speakerId: RecordId,
): Promise<readonly SpeakerStageChange[]> {
  const records = await getClient().listAll(TABLES.speakerStageHistory, historyCache(speakerId))
  return records
    .map(mapSpeakerStageChange)
    .filter((change) => change.speakerId === speakerId)
    .sort((left, right) => right.at.localeCompare(left.at))
}

export type StageChangeDraft = {
  speakerId: RecordId
  from: string
  to: string
  authorName: string
  /** The caller's instant, so the action owns the clock rather than this function. */
  at: string
}

/**
 * Append one move.
 *
 * Written AFTER the status itself, by `setSpeakerStageAction`, and the order is deliberate
 * for the reason `markSpeakersInvited` gives about its own two writes: a history row for a
 * move that then failed to land is a log that lies, while a landed move with no history row
 * is a log that is merely incomplete, and the second is the one an organizer can see and
 * correct.
 */
export async function appendStageChange(
  draft: StageChangeDraft,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().createRecords(TABLES.speakerStageHistory, [
    compact({
      [COL.at]: draft.at,
      [COL.speaker]: link(draft.speakerId),
      [COL.previousValue]: draft.from,
      [COL.newValue]: draft.to,
      [COL.authorName]: draft.authorName,
    }),
  ])

  // Only the history tag. The Speakers row was expired by the write that changed the status,
  // which names `speaker:{id}` and every linked event's roster for itself.
  invalidate(origin, { own: [speakerStageHistoryTag(draft.speakerId)] })
}
