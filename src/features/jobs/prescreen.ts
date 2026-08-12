// One tick of the AI pre-screen: claim a small batch of queued jobs, score each through
// the model, write the review, record the outcome on the row.
//
// It is a queue rather than an inline action because a round is tens of submissions and a
// Workers request cannot hold open for tens of model calls (the design doc says so, and it
// is the same reason the outbox is drained rather than sent inline).
//
// Every boundary is a dependency, exactly as in `accelevents-sync.ts`, because the cases
// worth pinning are interleavings: two ticks reaching one job, a model call that throws
// after the attempt was already stamped, a bookkeeping write that fails on the failure
// path. None of those are reachable through the UI.
//
// Three orderings are load-bearing:
//
//   1. **Claim before anything else.** The claim is per (round, submission), not per job
//      row, because the thing that must not happen twice is one submission being scored
//      twice: `saveReview` is keyed on (submission, round, reviewer), so a double run
//      would overwrite a review with a second opinion from the same reviewer and the
//      admin would never see that it happened.
//   2. **Stamp the attempt BEFORE the call.** A Worker cancelled mid-request never reaches
//      an "after", so an attempt counted on the way out is one a job that always dies
//      would never accumulate, and the retry cap would not hold.
//   3. **Release the key AFTER the outcome row is written.** The lease has to cover a
//      worst-case model call, so holding it until it expires charges every ordinary job
//      minutes it does not need; handing it back before the row is written lets the next
//      tick pick the job up in a state this one has not finished recording.

import { isAppError } from '@/constants/errorIds'
import {
  eligiblePrescreenJobs,
  PRESCREEN_BATCH,
  PRESCREEN_LEASE_MS,
} from '@/features/jobs/prescreen-queue'
import {
  labelledComment,
  type PrescreenResult,
  type PrescreenSubmission,
} from '@/features/jobs/prescreen-rubric'
import type { Criterion, RecordId } from '@/types/domain'
import type { AiPrescreenJob, AiPrescreenStatus } from '@/types/prescreen'

/** The round's rubric, which is all the drain needs of a `Round`. */
export type PrescreenRound = { readonly id: RecordId; readonly criteria: readonly Criterion[] }

/** What the drain hands `saveReview`. Matches `ReviewSave` in mutations-review.ts. */
export type PrescreenReviewSave = {
  readonly eventId: RecordId
  readonly submissionId: RecordId
  readonly roundId: RecordId
  readonly reviewerId: RecordId
  readonly scores: Record<string, number>
  readonly comment: string
  readonly recommendation: PrescreenResult['recommendation']
  readonly updatedAt: string
}

export type PrescreenJobPatch = {
  readonly status: AiPrescreenStatus
  readonly attempts?: number
  readonly error?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly mocked?: boolean
}

/**
 * Which row to write, and which event's progress line it belongs to.
 *
 * The event travels with the reference rather than being read back off the row, because
 * this is called twice per job on a rate-limited API and the drain already holds it.
 */
export type PrescreenJobRef = { readonly id: RecordId; readonly eventId: RecordId }

export type PrescreenDrainDeps = {
  /** Every job row, uncached: deciding what to run from a cached list runs it twice. */
  listJobs: () => Promise<readonly AiPrescreenJob[]>
  loadRound: (roundId: RecordId) => Promise<PrescreenRound>
  loadSubmission: (submissionId: RecordId) => Promise<PrescreenSubmission>
  /** The model call, already parsed and validated against the round's criteria. */
  score: (input: {
    round: PrescreenRound
    submission: PrescreenSubmission
  }) => Promise<PrescreenResult>
  saveReview: (save: PrescreenReviewSave) => Promise<void>
  updateJob: (job: PrescreenJobRef, patch: PrescreenJobPatch) => Promise<void>
  /** The seeded `ai@system` AdminUsers row. Resolved once per tick by the caller. */
  aiReviewerId: RecordId
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /**
   * Hand the key back once the job has settled, so the next attempt is not made to wait
   * out a lease sized for a Worker that died. See the ordering note in the drain.
   */
  release: (key: string, holder: string) => Promise<{ released: boolean }>
  /** Unique per invocation: `claimOnce` re-grants to the same holder, so a shared one
   * would hand two overlapping ticks the same submission. */
  holder: string
  now: () => string
  /**
   * Whether `score` reaches the model or the keyless sample.
   *
   * Recorded on the finished row rather than inferred later, because nothing about the
   * review it wrote says which one produced it: a sample writes an ordinary AI review, and
   * `prescreenTargets` needs the difference to let a live run supersede a sample one.
   */
  mocked: boolean
  batchSize?: number
}

export type PrescreenDrainResult = {
  /** Jobs this tick was willing to attempt, after the cap and the batch size. */
  found: number
  scored: number
  failed: number
  /** Held by another tick. Not an error, and not retried in this run. */
  contended: number
}

export async function drainPrescreenJobs(deps: PrescreenDrainDeps): Promise<PrescreenDrainResult> {
  const jobs = eligiblePrescreenJobs(await deps.listJobs(), deps.batchSize ?? PRESCREEN_BATCH)
  const result: PrescreenDrainResult = { found: jobs.length, scored: 0, failed: 0, contended: 0 }
  const rounds = new Map<RecordId, PrescreenRound>()

  for (const job of jobs) {
    const claim = await deps.claim(claimKey(job), deps.holder, PRESCREEN_LEASE_MS)
    if (!claim.granted) {
      result.contended += 1
      continue
    }

    // `.catch` rather than a try around the loop body: one submission the model refuses
    // must not take the other nine with it, and `runOne` already reports its own failure
    // on the row. What lands here is a bookkeeping write that failed too, which is
    // counted and dropped for the reason `recordSkip` in accelevents-sync.ts explains.
    const ok = await runOne(job, rounds, deps).catch(() => false)
    if (ok) result.scored += 1
    else result.failed += 1

    // AFTER `runOne` has settled, and that is the whole ordering: `runOne` writes the
    // outcome row on both paths before it returns, so by here the row says what happened.
    // Released any earlier and the next tick could take the key while this one was still
    // writing, find the job `running` with an attempt to spare, and score the abstract a
    // second time, which is the exact collision the claim exists to stop. Released here,
    // a job that failed in a second is retried on the next cron tick instead of fourteen
    // minutes later, and the lease is paid only by a tick that never came back at all.
    //
    // The `.catch` is not defensive noise: `releaseClaim` reports rather than throws, but
    // the drain must not depend on that to keep going. A key it could not hand back
    // expires on its own; the jobs after this one in the batch have keys that are free
    // now, and dropping them would cost a whole tick over bookkeeping.
    await deps.release(claimKey(job), deps.holder).catch(() => undefined)
  }

  return result
}

/** Per submission and round, so two rows for one abstract cannot both be scored. */
function claimKey(job: AiPrescreenJob): string {
  return `prescreen:${job.roundId}:${job.submissionId}`
}

async function runOne(
  job: AiPrescreenJob,
  rounds: Map<RecordId, PrescreenRound>,
  deps: PrescreenDrainDeps,
): Promise<boolean> {
  const ref: PrescreenJobRef = { id: job.id, eventId: job.eventId }
  await deps.updateJob(ref, {
    status: 'running',
    attempts: job.attempts + 1,
    startedAt: deps.now(),
  })

  try {
    const round = await roundFor(job.roundId, rounds, deps)
    const submission = await deps.loadSubmission(job.submissionId)
    const result = await deps.score({ round, submission })

    await deps.saveReview({
      eventId: job.eventId,
      submissionId: job.submissionId,
      roundId: job.roundId,
      reviewerId: deps.aiReviewerId,
      scores: result.scores,
      // Labelled here, where the row is written, so the label travels with the review
      // instead of living only in whichever surface happens to render it.
      comment: labelledComment(result.comment),
      recommendation: result.recommendation,
      updatedAt: deps.now(),
    })

    await deps.updateJob(ref, { status: 'done', finishedAt: deps.now(), mocked: deps.mocked })
    return true
  } catch (error) {
    // The attempt is already on the row, so this write only has to record WHY. A throw
    // from here reaches the per-job guard above, which counts it and moves on.
    await deps.updateJob(ref, {
      status: 'failed',
      error: describe(error),
      finishedAt: deps.now(),
    })
    return false
  }
}

/**
 * The round's rubric, memoised per tick.
 *
 * A batch is usually ten jobs in one round, and the criteria do not change while the tick
 * runs, so reading them per job would spend the Airtable budget the model calls need.
 * Same reasoning as `eventUrlFor` in accelevents-sync.ts.
 */
async function roundFor(
  roundId: RecordId,
  cache: Map<RecordId, PrescreenRound>,
  deps: PrescreenDrainDeps,
): Promise<PrescreenRound> {
  const found = cache.get(roundId)
  if (found !== undefined) return found
  const loaded = await deps.loadRound(roundId)
  cache.set(roundId, loaded)
  return loaded
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
