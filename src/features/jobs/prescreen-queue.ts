// Which submissions get queued and which jobs get run next.
//
// Pure, and separate from both the drain and the rubric, because these are the questions an
// organizer will ask about ("why did it skip that one?", "why is it stuck at 31 of 32?") and
// each answer should be a function somebody can read. The sentences those answers are
// rendered as live next door in prescreen-copy.ts, and the arithmetic of "how far has it
// got" is in prescreen-counts.ts.

import {
  attemptable,
  PRESCREEN_MAX_ATTEMPTS,
  prescreenStopped,
} from '@/features/jobs/prescreen-counts'
import { AI_WORST_CASE_CALL_MS } from '@/services/ai/limits'
import { WORST_CASE_CALL_MS } from '@/services/airtable/scheduler'
import type { RecordId } from '@/types/domain'
import type { AiPrescreenJob } from '@/types/prescreen'

// Counting the queue moved to prescreen-counts.ts when the retry rule below pushed this
// file past the size limit. Re-exported rather than repointed at every call site, because
// "what should run" and "how far has it got" are one question to everything that asks.
export {
  PRESCREEN_FAILURE_SAMPLE,
  PRESCREEN_MAX_ATTEMPTS,
  type PrescreenCounts,
  type PrescreenFailure,
  prescreenCounts,
  prescreenFailures,
  prescreenOutstanding,
} from '@/features/jobs/prescreen-counts'

/**
 * Jobs per tick. Ten, because each one is roughly six Airtable requests plus a model call,
 * and the base's budget is 5 requests per second (BUILD_SPEC 3.1). A larger batch does not
 * finish a round sooner, it just spends the tick queued behind the scheduler.
 */
export const PRESCREEN_BATCH = 10

/**
 * Airtable requests per job: the `running` write, the round, the submission, `saveReview`,
 * the final write. Six not five: `saveReview` looks the review up first.
 */
const PRESCREEN_JOB_AIRTABLE_CALLS = 6

/**
 * How long one tick holds a (round, submission) while it scores it.
 *
 * Sized from the two worst cases it covers rather than from a round number, the same way
 * `PRESCREEN_ENQUEUE_LEASE_MS` is, and for a sharper reason: it has to outlast the WHOLE of
 * `runOne`, and a lease that expires under a job in flight is not an error anywhere. The
 * next tick finds the row still `running` with attempts left, `attemptable` says yes,
 * `claimOnce` grants the key to the new holder, and the abstract is scored a second time:
 * two model calls billed, and two `saveReview` writes to the one row keyed on (submission,
 * round, reviewer), so the second silently overwrites the first.
 *
 * Both halves are policy ceilings rather than guesses: the model call cannot outrun
 * `AI_WORST_CASE_CALL_MS` (attempts times the per-request timeout, plus the SDK's backoff),
 * and each Airtable request can spend `WORST_CASE_CALL_MS` on its own because the DAL
 * honours a `Retry-After` and retries. Unbounded, the SDK defaults allowed over half an
 * hour for one abstract, which no lease was ever going to cover.
 *
 * **The wait is now paid only by a job whose Worker actually died.** The drain releases the
 * key as soon as the outcome row is written, so an ordinary failure is retried on the next
 * tick; what still holds a lease to its end is the case no release can cover, an isolate
 * cancelled before that write, which reaches no "after" to release in. That is the right way
 * round: a slow retry is a delay on the progress line, while a double score is a wrong number
 * written over a right one, charged twice, with nothing on any surface to say it happened.
 *
 * `AI_WORST_CASE_CALL_MS` comes from limits.ts rather than `@/services/ai` because a
 * `'use client'` panel imports this module (see notice.ts); scheduler.ts passes that same
 * test, being fetch and arithmetic with no Airtable SDK behind it.
 */
export const PRESCREEN_LEASE_MS =
  AI_WORST_CASE_CALL_MS + PRESCREEN_JOB_AIRTABLE_CALLS * WORST_CASE_CALL_MS

export type PrescreenTargetInput = {
  readonly roundId: RecordId
  /** The AdminUsers row every AI review is written under. */
  readonly aiReviewerId: RecordId
  /**
   * Whether the run being planned will reach the model or the keyless mock (`AI_MOCK`).
   *
   * It decides one thing only: whether a sample result already on the board may be
   * superseded. See `prescreenTargets`.
   */
  readonly mocked: boolean
  readonly assignments: readonly { readonly submissionId: RecordId; readonly roundId: RecordId }[]
  readonly reviews: readonly {
    readonly submissionId: RecordId
    readonly roundId: RecordId
    readonly reviewerId: RecordId
  }[]
  /** Job rows that already exist for this event, in any status. */
  readonly jobs: readonly AiPrescreenJob[]
}

export type PrescreenTargets = {
  /** Submissions with no row of their own yet: one new job each. */
  readonly create: readonly RecordId[]
  /**
   * Job ids sent back to the head of the queue in place: a stopped row the organizer is
   * retrying, or a SAMPLE result a live run supersedes. Ids rather than submissions because
   * the row already exists and must be reused: the progress line counts rows, so a second
   * row for one abstract is the "33 of 32" the skip below exists to prevent.
   */
  readonly reset: readonly RecordId[]
}

/**
 * What one press of `AI pre-screen` should do to one round.
 *
 * Five rules, and each one is a decision rather than a filter:
 *
 *   - **An assignment is required.** BUILD_SPEC 5.4 makes the pre-screen a second opinion
 *     inside a committee's round, not a way to score submissions nobody was asked to read.
 *     An abstract with no reviewer has no round state to be a second opinion on.
 *   - **An existing AI review for this round is a skip**, so pressing the button twice
 *     costs nothing. A HUMAN review is not: the whole point is that the two are
 *     independent, and skipping the ones a reviewer got to first would bias the set the
 *     model ever sees toward the abstracts nobody wanted.
 *   - **A job row that is still moving is a skip**, queued, running or failed with attempts
 *     left. Re-queueing one would create a second row for the same abstract, and the
 *     progress line counts rows: the round would read as 33 of 32 and never finish.
 *   - **A STOPPED row is retried in place, and pressing the button is how.** This is the
 *     rule that was missing, and it made a whole round unrecoverable: every job for a round
 *     failed three times (the rubric schema the model API rejected with a 400), every row
 *     was a skip "in any status", so the press answered `0 queued` and the panel said the
 *     round was already covered with nothing scored and no way back. A stopped row is the
 *     one state where re-running is the only useful thing left, and it is reset rather than
 *     duplicated for the same reason a superseded sample is. Retried whatever kind of run
 *     this is: a sample run that died is no more finished than a live one.
 *   - **A LIVE run supersedes a SAMPLE one, and never the other way round.** A round
 *     pre-screened under the default `AI_MOCK=1` carries ordinary AI reviews and done job
 *     rows, so without the `mocked` column adding a key and pressing the button again
 *     skipped every submission forever, which is exactly the path a judge takes.
 */
export function prescreenTargets(input: PrescreenTargetInput): PrescreenTargets {
  const scored = aiScoredSubmissions(input)
  const jobsBySubmission = jobsPerSubmission(input.jobs, input.roundId)

  const create: RecordId[] = []
  const reset: RecordId[] = []
  const seen = new Set<RecordId>()
  for (const assignment of input.assignments) {
    if (assignment.roundId !== input.roundId) continue
    // Deduplicated here rather than by the caller: a committee of six is six assignment
    // rows per submission and exactly one job.
    if (seen.has(assignment.submissionId)) continue
    seen.add(assignment.submissionId)

    const jobs = jobsBySubmission.get(assignment.submissionId) ?? []
    if (jobs.length === 0) {
      if (!scored.has(assignment.submissionId)) create.push(assignment.submissionId)
      continue
    }

    // A row exists, so nothing here is ever created twice. The only question left is
    // whether this run may put one of them back at the head of the queue.
    const requeue = requeueableJobId(jobs, input.mocked)
    if (requeue !== undefined) reset.push(requeue)
  }
  return { create, reset }
}

/**
 * The one row for this submission that goes back to the head of the queue, or nothing.
 *
 * Two reasons to requeue and they are asked in this order, because a stopped row is stopped
 * whatever wrote it: a sample run that ran out of attempts is not a sample result to be
 * superseded, it is a run that never produced one.
 */
function requeueableJobId(jobs: readonly AiPrescreenJob[], mocked: boolean): RecordId | undefined {
  const stopped = stoppedJobId(jobs)
  if (stopped !== undefined) return stopped
  return mocked ? undefined : supersededJobId(jobs)
}

/**
 * The one stopped row this press retries, or nothing.
 *
 * Both rules are the same rule the supersede below follows: one abstract, one model call.
 *
 *   - **Every row for the submission has to be stopped.** A queued or running twin is going
 *     to be attempted by the next tick, so resetting a stopped row beside it would score the
 *     abstract twice; a DONE twin means the submission already has its AI review and there
 *     is nothing to retry.
 *   - **Exactly one of them is reset**, oldest first, even though the base can hold several.
 *     The others stay stopped, so they still count as settled and the round's total does not
 *     move under the organizer mid-run.
 */
function stoppedJobId(jobs: readonly AiPrescreenJob[]): RecordId | undefined {
  if (!jobs.every(prescreenStopped)) return undefined
  return [...jobs].sort(byQueueOrder).at(0)?.id
}

/**
 * The one row a live run sends back to the head of the queue, or nothing.
 *
 * Two rules, and both are the same rule: one abstract, one model call.
 *
 *   - **Every row for the submission has to be sampled.** `mocked` is written when a run
 *     FINISHES, so a true is a done row and a false is either a live verdict or a row still
 *     waiting for this run's tick. Resetting a sample beside a queued twin would score the
 *     abstract twice.
 *   - **Exactly one of them is reset**, even though the base can hold several. Airtable has
 *     no uniqueness constraint, so two rows for one abstract is a state it can genuinely be
 *     in, and requeueing both is two model calls on the next tick with the second review
 *     overwriting the first. The others are left where they are rather than retired: they
 *     are done and sampled, so they still count as settled and the total does not move
 *     under the organizer mid-run.
 */
function supersededJobId(jobs: readonly AiPrescreenJob[]): RecordId | undefined {
  if (!jobs.every((job) => job.mocked)) return undefined
  return [...jobs].sort(byQueueOrder).at(0)?.id
}

/**
 * Queue order: oldest first, tie-broken on the id.
 *
 * Shared by the drain's batch, the retry and the supersede, so "the first row for this
 * submission" means one thing in all three. The tie-break is what makes it stable: a round
 * is queued with a single instant for the whole batch, so `queuedAt` alone leaves the answer
 * to whatever order Airtable happened to list the rows in, which is not a promise it makes.
 */
function byQueueOrder(left: AiPrescreenJob, right: AiPrescreenJob): number {
  const byQueuedAt = left.queuedAt.localeCompare(right.queuedAt)
  if (byQueuedAt !== 0) return byQueuedAt
  return left.id.localeCompare(right.id)
}

/** The submissions this round already carries an AI review for. */
function aiScoredSubmissions(input: PrescreenTargetInput): ReadonlySet<RecordId> {
  return new Set(
    input.reviews
      .filter(
        (review) => review.roundId === input.roundId && review.reviewerId === input.aiReviewerId,
      )
      .map((review) => review.submissionId),
  )
}

/**
 * This round's job rows, grouped by submission.
 *
 * A list per submission rather than one row, because Airtable has no uniqueness constraint
 * and two rows for one abstract are a state the base can genuinely be in.
 */
function jobsPerSubmission(
  jobs: readonly AiPrescreenJob[],
  roundId: RecordId,
): ReadonlyMap<RecordId, readonly AiPrescreenJob[]> {
  const grouped = new Map<RecordId, AiPrescreenJob[]>()
  for (const job of jobs) {
    if (job.roundId !== roundId) continue
    const found = grouped.get(job.submissionId)
    if (found === undefined) grouped.set(job.submissionId, [job])
    else found.push(job)
  }
  return grouped
}

/** Oldest first, capped at the batch size. Sorted so a backlog drains in queue order. */
export function eligiblePrescreenJobs(
  jobs: readonly AiPrescreenJob[],
  batchSize: number = PRESCREEN_BATCH,
): readonly AiPrescreenJob[] {
  return [...jobs].filter(attemptable).sort(byQueueOrder).slice(0, batchSize)
}
