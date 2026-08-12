// Writes for the AI pre-screen queue: enqueue a round's jobs, and record what happened to
// one of them.
//
// Same rule as every other mutation file here: the write ends in invalidate.ts, and the
// tags it names are the ones its own reads carry. Both of these run from two different
// origins (the enqueue from a Server Action, the update from the cron Route Handler),
// which is exactly the case `invalidate` exists to make identical.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { TABLES } from '@/services/airtable/tables'
import { eventPrescreenTag } from '@/services/airtable/tags-prescreen'
import {
  type PrescreenJobPatchFields,
  prescreenJobFields,
  prescreenJobPatchFields,
  prescreenJobResetFields,
} from '@/services/airtable/to-fields-prescreen'
import type { RecordId } from '@/types/domain'

export type PrescreenEnqueue = {
  readonly eventId: RecordId
  readonly roundId: RecordId
  readonly submissionIds: readonly RecordId[]
  /**
   * One instant for the whole batch, so a round queued together reads as one action in the
   * log rather than forty timestamps a few milliseconds apart. Same reasoning as
   * `enterSubmissionsIntoRound`.
   */
  readonly queuedAt: string
}

/**
 * Create one job row per submission.
 *
 * NOT idempotent by itself, and deliberately not: idempotency lives in `prescreenTargets`,
 * which is given the existing rows and drops anything already queued. Reading the table a
 * second time here would be the same check twice, and the two could disagree.
 */
export async function enqueuePrescreenJobs(
  enqueue: PrescreenEnqueue,
  origin: WriteOrigin = 'action',
): Promise<{ created: number }> {
  if (enqueue.submissionIds.length === 0) return { created: 0 }

  // Chunked at 10 by the client, so a round of forty is four requests through the
  // scheduler rather than forty single writes.
  await getClient().createRecords(
    TABLES.aiPrescreenJobs,
    enqueue.submissionIds.map((submissionId) =>
      prescreenJobFields({
        eventId: enqueue.eventId,
        roundId: enqueue.roundId,
        submissionId,
        queuedAt: enqueue.queuedAt,
      }),
    ),
  )

  invalidate(origin, { own: [eventPrescreenTag(enqueue.eventId)] })
  return { created: enqueue.submissionIds.length }
}

/**
 * Send superseded job rows back to the head of the queue.
 *
 * The one case is a round pre-screened by the keyless sample on a deployment that has since
 * been given a key: the rows are REUSED rather than re-created, because the progress line
 * counts rows and a second row per abstract is the "33 of 32" `prescreenTargets` refuses to
 * produce. Batched at 10 by the client, like the enqueue beside it.
 */
export async function resetPrescreenJobs(
  input: { readonly eventId: RecordId; readonly jobIds: readonly RecordId[] },
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (input.jobIds.length === 0) return

  await getClient().updateRecords(
    TABLES.aiPrescreenJobs,
    input.jobIds.map((id) => ({ id, fields: prescreenJobResetFields() })),
  )
  invalidate(origin, { own: [eventPrescreenTag(input.eventId)] })
}

/**
 * Record a job's progress or its failure.
 *
 * `eventId` is passed rather than read back off the row, because this is called twice per
 * job on a rate-limited API and the drain already holds it. Only the pre-screen tag is
 * expired: the review the job wrote expires `event:{id}:review` through `saveReview`
 * itself, so naming it here as well would expire every Abstracts table twice per job.
 */
export async function updatePrescreenJob(
  input: {
    readonly eventId: RecordId
    readonly jobId: RecordId
    readonly patch: PrescreenJobPatchFields
  },
  origin: WriteOrigin = 'route',
): Promise<void> {
  await getClient().updateRecords(TABLES.aiPrescreenJobs, [
    { id: input.jobId, fields: prescreenJobPatchFields(input.patch) },
  ])
  invalidate(origin, { own: [eventPrescreenTag(input.eventId)] })
}
