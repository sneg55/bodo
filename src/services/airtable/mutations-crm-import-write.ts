// The write mechanics for one `chunkForAirtable` group of speaker import rows: batch first,
// fall back to one request per row only when the failure is row-attributable. Split out of
// mutations-crm-import.ts for the line limit; that file is the per-chunk orchestration and
// the outer loop.
//
// The fallback only fires for a failure ATTRIBUTABLE to the specific rows in the request.
// A base-wide problem - rate limiting, an unreachable base, an auth failure - is not fixed
// by asking the same question ten smaller times, and doing so anyway is how a 500-row
// import during a throttled base turns ~50 requests into ~550, all of which still fail.
// `isRowAttributable` reads the actual error id and HTTP status client.ts and scheduler.ts
// attach, rather than guessing from a message string, and a non-row-attributable error is
// rethrown so the caller aborts instead of hammering.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import type { AirtableClient } from '@/services/airtable/client'
import type { SpeakerImportRow } from '@/services/airtable/mutations-crm-import-plan'
import type { AirtableRecord } from '@/services/airtable/records'
import type { RecordId } from '@/types/domain'

export type RowWrite = {
  readonly index: number
  readonly record: AirtableRecord
  readonly row: SpeakerImportRow
  readonly wasCreate: boolean
  readonly eventIds: readonly RecordId[]
}
export type RowWriteFailure = {
  readonly index: number
  readonly row: SpeakerImportRow
  readonly reason: string
}

function describeWriteError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown write error'
}

/**
 * The only HTTP statuses that mean Airtable rejected THIS record's data, as opposed to the
 * request as a whole. Deliberately an allow-list rather than a range with exceptions carved
 * out: 400 is a malformed field, 422 is a validation rejection, and both are genuinely about
 * the row's own content. Every other 4xx is either an auth problem (401, 403: the request
 * itself is not authorized, not that one record's data was bad) or a transport-level issue
 * that happens to arrive as a 4xx - a 408 request timeout is NOT retried by the scheduler
 * (`scheduler.ts`'s `retryable = status === 429 || status >= 500`, so 408 falls straight
 * through to `failure()` as `DATA_WRITE_FAIL` with `context.status = 408`) and retrying the
 * same ten rows one at a time just asks the same failing question ten more times. An
 * allow-list is the right shape here because the failure mode of getting it wrong is
 * asymmetric: a status wrongly INCLUDED amplifies requests against a struggling base, a
 * status wrongly EXCLUDED just aborts an import the user can retry, which is the safer
 * direction to be wrong in.
 */
const ROW_ATTRIBUTABLE_STATUSES = new Set([400, 422])

/**
 * Whether a caught write error is attributable to the specific rows in THIS request, so
 * retrying them one at a time might isolate a bad one, as opposed to a base-level problem
 * that retrying per row would only multiply.
 *
 * `client.ts`'s `failure()` turns every non-2xx write response into `DATA_WRITE_FAIL` (or
 * `DATA_RECORD_NOT_FOUND` for a 404), with the real HTTP status carried in `context.status`
 * for the former. `scheduler.ts` intercepts 429 and repeated 5xx before that ever happens
 * and throws its own `DATA_RATE_LIMITED` or `NET_UNAVAILABLE` once retries are exhausted;
 * neither of those is ever row-specific. `DATA_RECORD_NOT_FOUND` is included unconditionally:
 * an update whose `recordId` went stale between `loadSpeakersByEmail` and the write is a
 * genuinely row-specific problem, exactly the kind the fallback exists to isolate. A 404
 * could in principle also mean a missing base or table rather than a missing record, but
 * that case is unreachable here: `loadSpeakersByEmail` lists the same Speakers table before
 * any chunk runs, and a missing base or table would have thrown there first.
 */
function isRowAttributable(error: unknown): boolean {
  if (!isAppError(error)) return false
  if (error.id === ErrorIds.DATA_RECORD_NOT_FOUND) return true
  if (error.id !== ErrorIds.DATA_WRITE_FAIL) return false
  const status = error.context.status
  return typeof status === 'number' && ROW_ATTRIBUTABLE_STATUSES.has(status)
}

export type ChunkPlan = {
  readonly row: SpeakerImportRow
  readonly index: number
  readonly eventIds: readonly RecordId[]
  /**
   * The speaker record this plan writes to, on the UPDATE path only: it is the id
   * `planRow` matched by email BEFORE the write, so it survives a response that cannot be
   * read. Absent on a create, because the record did not exist and no id came back. That
   * asymmetry is the response's, not an oversight; see `UncertainWrite`.
   */
  readonly recordId?: RecordId
}

/**
 * What is still known about a write whose response could not be read: every id that was
 * known BEFORE the request went out, so the caller can expire those tags anyway.
 *
 * `speakerIds` is empty on the create path and populated on the update path, for the reason
 * on `ChunkPlan.recordId`.
 */
export type UncertainWrite = {
  readonly eventIds: readonly RecordId[]
  readonly speakerIds: readonly RecordId[]
}

/** Everything a group of plans still knows about itself once its response is unreadable. */
function uncertainWrite<Plan extends ChunkPlan>(plans: readonly Plan[]): UncertainWrite {
  return {
    eventIds: [...new Set(plans.flatMap((plan) => plan.eventIds))],
    speakerIds: [
      ...new Set(plans.flatMap((plan) => (plan.recordId === undefined ? [] : [plan.recordId]))),
    ],
  }
}

type ChunkWriteOps<Plan> = {
  readonly client: AirtableClient
  readonly plans: readonly Plan[]
  readonly wasCreate: boolean
  readonly writeMany: (
    client: AirtableClient,
    plans: readonly Plan[],
  ) => Promise<readonly AirtableRecord[]>
  readonly writeOne: (client: AirtableClient, plan: Plan) => Promise<readonly AirtableRecord[]>
  /**
   * Called once per row whose outcome is known - a batch success, a shape-mismatch failure,
   * or a fallback row that settled - rather than collected into an array `writeChunk`
   * returns at the end. The guarantee is about ORDER RELATIVE TO THROWING, not latency:
   * every settled row reaches the caller through this callback BEFORE any error propagates.
   * (In the fallback specifically, `Promise.allSettled` waits for every row first, so a row
   * that settles early is still recorded only once its slowest sibling has settled.) That is
   * what lets a later sibling's systemic failure abort the chunk without discarding an
   * earlier sibling's already-written result.
   */
  readonly onSettled: (result: RowWrite | RowWriteFailure) => void
  /**
   * Called whenever a write answers SUCCESSFULLY but with a response that cannot name what
   * it wrote: a batch answered with the WRONG record count (see `writeChunk`'s
   * shape-mismatch branch), or a single fallback row answered with no record at all (see
   * `writeSingleRow`). Those rows are still reported failed through `onSettled`, because
   * none of their RECORD ids are known - but "none of their ids are known" is not the same
   * claim as "nothing was written". Airtable may have committed nine of the ten records and
   * returned a short list, or committed the one row and returned an empty array; the honest
   * position is "something may have landed", not "nothing did".
   *
   * Called once for the whole group on the batch path, and once for the single plan on the
   * fallback path, rather than per settled row. It is NOT called for a REJECTED request: a
   * non-2xx answer wrote nothing, and expiring tags for it would be invalidation with no
   * write behind it.
   *
   * Carries every id known BEFORE the request went out (`uncertainWrite`), which is more
   * than the import's own target event. An UPDATE plan's `eventIds` is the matched
   * speaker's merged event set (`planRow`), so an unreadable answer on the update sub-batch
   * can touch a speaker's OTHER events too, and that plan's `recordId` names the speaker
   * itself - the same reason `onSettled`'s normal success path passes `plan.eventIds`
   * rather than only `state.eventId`.
   */
  readonly onUncertainWrite: (write: UncertainWrite) => void
}

/** Every row in a group that got a successful-but-wrong-length response, as failures. */
function shapeMismatchFailures<Plan extends ChunkPlan>(
  plans: readonly Plan[],
  got: number,
): readonly RowWriteFailure[] {
  return plans.map((plan) => ({
    index: plan.index,
    row: plan.row,
    reason: `Airtable returned ${String(got)} records for a ${String(plans.length)}-row request`,
  }))
}

/**
 * One isolated retry inside the fallback.
 *
 * A single object parameter rather than five positional ones, the convention
 * `DrainDeps.markFailed` and `OutboxLease.record` in src/features/comms/drain.ts already
 * set: `onUncertainWrite` is the fifth argument and a fifth positional parameter trips the
 * `max-params` lint rule.
 */
async function writeSingleRow<Plan extends ChunkPlan>(input: {
  readonly client: AirtableClient
  readonly plan: Plan
  readonly wasCreate: boolean
  readonly writeOne: ChunkWriteOps<Plan>['writeOne']
  readonly onUncertainWrite: ChunkWriteOps<Plan>['onUncertainWrite']
}): Promise<RowWrite | RowWriteFailure> {
  const { client, plan, wasCreate, writeOne, onUncertainWrite } = input
  try {
    const written = await writeOne(client, plan)
    const record = written.at(0)
    if (record === undefined) {
      // The same claim the batch branch below rejects, on the path beside it: a successful
      // answer that names no record is not an answer that nothing was written. This row is
      // still reported failed, because its id is unknowable, but the ids known before the
      // request went out are expired anyway. A REJECTED retry is the other case entirely
      // and it goes to the `catch`, which reports the failure and expires nothing.
      onUncertainWrite(uncertainWrite([plan]))
      return { index: plan.index, row: plan.row, reason: 'Airtable returned no record' }
    }
    return { index: plan.index, record, row: plan.row, wasCreate, eventIds: plan.eventIds }
  } catch (error) {
    if (!isRowAttributable(error)) throw error
    return { index: plan.index, row: plan.row, reason: describeWriteError(error) }
  }
}

/**
 * The per-row fallback, folding every row's result in before it rethrows, rather than
 * collecting them into one array that a single rejection discards.
 *
 * This is the same defect class the chunk-level orchestration was fixed for: `Promise.all`
 * rejects as soon as any one of its promises rejects, discarding the other promises'
 * already-fulfilled results. Row 1's isolated retry can succeed - a real write, already in
 * Airtable - and if row 2's retry then throws a systemic error (a 429, an auth failure),
 * `Promise.all` would throw row 1's result away before the caller ever learns it happened,
 * leaving a written speaker with no expired tag. `Promise.allSettled` plus folding each
 * fulfilled result through `onSettled` before rethrowing the first systemic rejection is
 * what keeps row 1's outcome from being lost.
 */
async function writeFallback<Plan extends ChunkPlan>(ops: ChunkWriteOps<Plan>): Promise<void> {
  const { plans, client, wasCreate, writeOne, onSettled, onUncertainWrite } = ops
  const outcomes = await Promise.allSettled(
    plans.map((plan) => writeSingleRow({ client, plan, wasCreate, writeOne, onUncertainWrite })),
  )

  let abortError: unknown
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      onSettled(outcome.value)
    } else if (abortError === undefined) {
      abortError = outcome.reason
    }
  }
  // The reason is `unknown` by the time it reaches here (Promise.allSettled), and every
  // real caller throws an Error (writeSingleRow only rethrows what it caught, which is
  // always an AppError). Wrapped defensively rather than asserted, so a non-Error rejection
  // still throws something `@typescript-eslint/only-throw-error` and every catch downstream
  // can rely on.
  if (abortError !== undefined) {
    throw abortError instanceof Error ? abortError : new Error(describeWriteError(abortError))
  }
}

/**
 * Write a batch of creates or updates, one Airtable request for the whole group when it
 * succeeds, falling back to one request per row only when the failure is row-attributable
 * (see `isRowAttributable`). Every other failure - rate limiting, an unreachable base, an
 * auth problem - is rethrown so the caller aborts instead of turning one bad request into
 * ten or eleven more that fail for the same reason.
 *
 * A successful response with the WRONG record count (no error, just a different length
 * than requested) is not retried per row either: on the CREATE path, retrying would
 * re-create every row in the group, duplicating speakers Airtable may already have
 * written. This should never happen for a well-formed batch request; if it ever does,
 * every row in the group is reported failed instead, since there is no reliable way to
 * tell which returned record belongs to which row.
 */
export async function writeChunk<Plan extends ChunkPlan>(ops: ChunkWriteOps<Plan>): Promise<void> {
  const { plans, client, wasCreate, writeMany, onSettled, onUncertainWrite } = ops
  if (plans.length === 0) return

  try {
    const batch = await writeMany(client, plans)
    if (batch.length === plans.length) {
      for (const [i, plan] of plans.entries()) {
        onSettled({
          index: plan.index,
          // `.at(i)` cannot be undefined here: the length check above guarantees a match.
          record: batch.at(i) as AirtableRecord,
          row: plan.row,
          wasCreate,
          eventIds: plan.eventIds,
        })
      }
      return
    }
    // Every plan reports failed - none of their ids are knowable from a short response -
    // but "not knowable" is not "nothing written". See `onUncertainWrite`'s doc.
    for (const failure of shapeMismatchFailures(plans, batch.length)) onSettled(failure)
    onUncertainWrite(uncertainWrite(plans))
  } catch (error) {
    if (!isRowAttributable(error)) throw error
    await writeFallback(ops)
  }
}
