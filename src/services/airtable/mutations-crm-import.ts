// The speaker CSV import write: `upsertSpeakersBatch`.
//
// Row shape and per-row planning are in mutations-crm-import-plan.ts; the batch-then-fallback
// write mechanics are in mutations-crm-import-write.ts (both split out for the line limit).
// This file is the per-chunk orchestration and the outer loop. `chunkForAirtable` stays in
// mutations-crm.ts because a fixed test path imports it from there.
//
// `upsertSpeakersBatch` does not deduplicate emails that repeat WITHIN one input batch.
// That is deliberate: the existing-speaker snapshot (`loadSpeakersByEmail`) is read once
// and only refreshed between chunks, so two rows sharing an email inside the same 10-row
// chunk both plan as a create. Catching that is a column-mapping concern (the dedup step
// reads the whole file before any row reaches this function), not a per-row write concern,
// and duplicating that check here would just be a second, weaker copy of it.
//
// It is not left to a caller's memory either: `rows` is `DedupedSpeakerRows`, which only
// `dedupeRows` in src/features/crm/import/dedup.ts produces, so skipping the dedup step does
// not compile. (Tests reach the brand through tests/helpers/deduped-batch.ts, which verifies
// the property before claiming it.)

import { type AirtableClient, getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { chunkForAirtable } from '@/services/airtable/mutations-crm'
import {
  type DedupedSpeakerRows,
  type ImportRowOutcome,
  loadSpeakersByEmail,
  planRow,
  type RowPlan,
  type SpeakerImportField,
  type SpeakerImportRow,
} from '@/services/airtable/mutations-crm-import-plan'
import {
  type RowWrite,
  type RowWriteFailure,
  type UncertainWrite,
  writeChunk,
} from '@/services/airtable/mutations-crm-import-write'
import type { AirtableRecord } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/tables'
import { eventSpeakersTag, speakerTag } from '@/services/airtable/tags'
import type { RecordId } from '@/types/domain'

export type { DedupedSpeakerRows, ImportRowOutcome, SpeakerImportField, SpeakerImportRow }

function failedOutcome(row: SpeakerImportRow, reason: string): ImportRowOutcome {
  return { rowNumber: row.rowNumber, status: 'failed', email: row.email, reason }
}

/** State threaded through one `upsertSpeakersBatch` call, folded chunk by chunk. */
type ImportState = {
  readonly client: AirtableClient
  readonly eventId: RecordId
  readonly byEmail: Map<string, AirtableRecord>
  /** Keyed by the row's INDEX in the caller's array, not `rowNumber`; see RowPlan's doc. */
  readonly outcomeByIndex: Map<number, ImportRowOutcome>
  readonly touchedSpeakers: Set<RecordId>
  /** Every event a written speaker now belongs to, not only the event this import targets. */
  readonly touchedEvents: Set<RecordId>
}

/** Fold one write result into the running outcome map, snapshot and touched-id sets. */
function recordResult(state: ImportState, result: RowWrite | RowWriteFailure): void {
  if ('reason' in result) {
    state.outcomeByIndex.set(result.index, failedOutcome(result.row, result.reason))
    return
  }
  const normalizedEmail = result.row.email.trim().toLowerCase()
  state.byEmail.set(normalizedEmail, result.record)
  state.touchedSpeakers.add(result.record.id)
  for (const eventId of result.eventIds) state.touchedEvents.add(eventId)
  state.outcomeByIndex.set(result.index, {
    rowNumber: result.row.rowNumber,
    status: result.wasCreate ? 'created' : 'updated',
    speakerId: result.record.id,
  })
}

function isKind<K extends RowPlan['kind']>(kind: K) {
  return (plan: RowPlan): plan is Extract<RowPlan, { kind: K }> => plan.kind === kind
}

/** Plan and write one `chunkForAirtable` group, folding its outcomes into `state`. */
async function processImportChunk(
  state: ImportState,
  group: readonly { readonly index: number; readonly row: SpeakerImportRow }[],
): Promise<void> {
  const plans = group.map(({ index, row }) => planRow(index, row, state.eventId, state.byEmail))

  for (const plan of plans) {
    if (plan.kind === 'invalid') {
      state.outcomeByIndex.set(plan.index, failedOutcome(plan.row, plan.reason))
    }
  }

  // `writeChunk` folds each row's result into `state` (via `onSettled`) before it can throw,
  // both across this create call and the update call below, AND within each call's own
  // per-row fallback (mutations-crm-import-write.ts). That is what keeps an earlier
  // sibling's already-written result from being discarded when a later one throws a
  // systemic error: by the time anything here can throw, every settled row already reached
  // `recordResult`, so `upsertSpeakersBatch`'s `finally` still expires the right tags.
  const onSettled = (result: RowWrite | RowWriteFailure): void => recordResult(state, result)
  // An answer that cannot be read - a short batch response, or a fallback row answered with
  // no record - names nothing it wrote, but "the answer names nothing" is not "nothing was
  // written" (mutations-crm-import-write.ts). What was known BEFORE the request went out is
  // still known, and it differs by sub-batch:
  //
  //   - Events, on both. Marks every event the group's plans could have touched, not only
  //     `state.eventId`: on the UPDATE sub-batch a plan's `eventIds` is the matched
  //     speaker's merged event set (`planRow`), so a matched speaker who also presents at
  //     another event needs that event's roster tag expired too, the same reason a
  //     SUCCESSFUL update names `plan.eventIds` in `recordResult`.
  //   - Speakers, on the UPDATE sub-batch only, and the asymmetry is the response's rather
  //     than an oversight. An update plan carries the `recordId` it matched by email before
  //     the write, so the speaker IS known even when the answer is unreadable, and leaving
  //     it out left a cached profile at /admin/crm/[speakerId] serving the old name, bio or
  //     company for the whole window while the roster refreshed around it. A CREATE has no
  //     id to offer: the record did not exist and none came back, so `speakerIds` is empty
  //     there and the create path stays event-only.
  const onUncertainWrite = ({ eventIds, speakerIds }: UncertainWrite): void => {
    for (const eventId of eventIds) state.touchedEvents.add(eventId)
    for (const speakerId of speakerIds) state.touchedSpeakers.add(speakerId)
  }

  await writeChunk({
    plans: plans.filter(isKind('create')),
    client: state.client,
    wasCreate: true,
    writeMany: (c, p) =>
      c.createRecords(
        TABLES.speakers,
        p.map((plan) => plan.fields),
      ),
    writeOne: (c, p) => c.createRecords(TABLES.speakers, [p.fields]),
    onSettled,
    onUncertainWrite,
  })

  await writeChunk({
    plans: plans.filter(isKind('update')),
    client: state.client,
    wasCreate: false,
    writeMany: (c, p) =>
      c.updateRecords(
        TABLES.speakers,
        p.map((plan) => ({ id: plan.recordId, fields: plan.fields })),
      ),
    writeOne: (c, p) => c.updateRecords(TABLES.speakers, [{ id: p.recordId, fields: p.fields }]),
    onSettled,
    onUncertainWrite,
  })
}

/**
 * Every `eventSpeakersTag` and `speakerTag` a batch touched. `[]` when nothing wrote and
 * nothing MAY have written. `touchedEvents` can be non-empty with `touchedSpeakers` still
 * empty - an unreadable answer on the CREATE sub-batch marks its events but can name no
 * speaker (`onUncertainWrite` above) - so both sets are checked, not only speakers.
 */
function touchedTags(state: ImportState): readonly string[] {
  if (state.touchedSpeakers.size === 0 && state.touchedEvents.size === 0) return []
  return [
    ...[...state.touchedEvents].map(eventSpeakersTag),
    ...[...state.touchedSpeakers].map(speakerTag),
  ]
}

/**
 * Create or update one speaker per row, matched on normalized email, and never throw for a
 * single BAD ROW: a CSV import where row 7 is malformed must still land rows 1-6 and 8-25.
 * A SYSTEMIC failure (rate limiting, an unreachable base, an auth problem) is different and
 * does propagate, so the caller can stop and retry rather than the import silently
 * hammering an already-struggling base; see mutations-crm-import-write.ts.
 *
 * Processed in `chunkForAirtable` groups so each Airtable request stays at or under the
 * 10-record ceiling. The existing-speaker snapshot (`loadSpeakersByEmail`) is read once
 * up front and updated after each chunk with that chunk's own writes, so a repeated email
 * in a LATER chunk correctly resolves to an update; see the file header for why a repeat
 * within the SAME chunk does not. `rows` is branded rather than a plain array so that a
 * caller cannot reach this function without having resolved those repeats first.
 *
 * Invalidates every event a written speaker now belongs to, not only `eventId`: an update
 * merges this event into whatever events the matched speaker already had (`planRow`), so a
 * name or company change on a speaker who already presents at another event leaves that
 * event's roster stale unless its tag is named too. The `try`/`finally` runs invalidation
 * even when the loop above threw partway through, because whatever DID write before an
 * abort still needs its tags expired - an aborted import is not a reason to leave the
 * rows that landed showing stale everywhere they are read.
 */
export async function upsertSpeakersBatch(
  origin: WriteOrigin,
  eventId: RecordId,
  rows: DedupedSpeakerRows,
): Promise<readonly ImportRowOutcome[]> {
  if (rows.length === 0) return []

  const client = getClient()
  const state: ImportState = {
    client,
    eventId,
    byEmail: await loadSpeakersByEmail(client),
    outcomeByIndex: new Map(),
    touchedSpeakers: new Set(),
    touchedEvents: new Set(),
  }
  const indexed = rows.map((row, index) => ({ index, row }))

  try {
    for (const group of chunkForAirtable(indexed)) {
      await processImportChunk(state, group)
    }
  } finally {
    const tags = touchedTags(state)
    if (tags.length > 0) invalidate(origin, { own: tags })
  }

  // A `?? failedOutcome` safety net, not the expected path: every row is set above, either
  // as invalid, or as a create/update success or failure. This only fires if that ever
  // stops being true, and it still has to answer with one outcome per input row.
  return rows.map(
    (row, index) => state.outcomeByIndex.get(index) ?? failedOutcome(row, 'Row was not processed'),
  )
}
