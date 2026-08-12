// How far a round's pre-screen has got, and which of its jobs nothing will ever move again.
//
// Split out of prescreen-queue.ts, which was at the file limit when the retry rule landed
// beside `prescreenTargets`. The three names it used to export are re-exported from there,
// so nothing that already asks the queue module "how far has it got" had to move.
//
// The split is along a real seam rather than at a line count: everything here answers a
// question about jobs that ALREADY exist, and everything left in prescreen-queue.ts decides
// what to do about them.

import type { AiPrescreenJob } from '@/types/prescreen'

/**
 * How many times one submission may be sent to the model before the queue gives up on it.
 *
 * Three, and low on purpose. Every attempt costs a real model call, and the failures this
 * retries are transient by construction: a rate limit, a 5xx, a Worker cancelled mid-call.
 * Anything that fails three times is a submission that run will not score, and retrying it
 * forever spends money to produce the same error behind a progress bar that never finishes.
 *
 * What it is NOT is a verdict on the submission. A rubric the model API rejected outright
 * (the `minimum`/`maximum` keys the structured-output schema used to emit, HTTP 400 on every
 * call) burns all three attempts in a second and leaves a round with nothing scored. That is
 * why the cap is a stopping point the organizer can press past, not a terminal state: see
 * `prescreenStopped` and `prescreenTargets`.
 */
export const PRESCREEN_MAX_ATTEMPTS = 3

/**
 * Whether a job may be attempted now.
 *
 * `running` counts as attemptable, which looks wrong and is not. A Workers isolate can
 * disappear between the "running" write and the outcome write, and nothing else would ever
 * move that row: the queue would sit one short of complete forever. What stops two LIVE
 * ticks colliding is the claim in `drainPrescreenJobs`, held per (round, submission) for
 * the lease, so a genuinely in-flight job is refused and a genuinely abandoned one is
 * picked up once its lease has gone.
 */
export function attemptable(job: AiPrescreenJob): boolean {
  if (job.status === 'done') return false
  return job.attempts < PRESCREEN_MAX_ATTEMPTS
}

/**
 * Whether a job is one no tick will take again: not done, and out of attempts.
 *
 * Defined by what `eligiblePrescreenJobs` REFUSES rather than by the status column, which
 * is what makes it cover the row a Worker leaves behind when it is cancelled after stamping
 * the final attempt and before writing the outcome: `running`, at the cap, never picked up
 * again. Counting that as running told the organizer it was waiting for something that was
 * never going to happen.
 */
export function prescreenStopped(job: AiPrescreenJob): boolean {
  return job.status !== 'done' && !attemptable(job)
}

export type PrescreenCounts = {
  readonly total: number
  /** Waiting for a tick, with attempts left. */
  readonly queued: number
  /** Claimed by a tick that has not reported back, with attempts left. */
  readonly running: number
  readonly done: number
  /** Failed with attempts left, so the next tick tries again. */
  readonly failed: number
  /**
   * Jobs no tick will ever attempt again. See `prescreenStopped`.
   *
   * The five buckets are disjoint and sum to `total`, because the panel renders one badge
   * per bucket and a row in two of them is a row reported twice.
   */
  readonly blocked: number
}

export function prescreenCounts(jobs: readonly AiPrescreenJob[]): PrescreenCounts {
  let queued = 0
  let running = 0
  let done = 0
  let failed = 0
  let blocked = 0

  for (const job of jobs) {
    if (job.status === 'done') done += 1
    else if (prescreenStopped(job)) blocked += 1
    else if (job.status === 'queued') queued += 1
    else if (job.status === 'running') running += 1
    else failed += 1
  }

  return { total: jobs.length, queued, running, done, failed, blocked }
}

/**
 * Whether the round still has work the organizer is waiting on.
 *
 * The progress line's freshness depends on it. Cron moves the jobs and each write expires
 * `event:{id}:prescreen`, so the NEXT request renders the new number, but an organizer
 * sitting on an already-painted page makes no next request: the panel polls while this is
 * true, exactly as the tasks dashboard does, and stops the moment it is false. A stopped
 * job counts as settled rather than outstanding, because nothing will move it again until
 * somebody presses the button, and polling for it would mean polling forever.
 */
export function prescreenOutstanding(counts: PrescreenCounts): boolean {
  return counts.total > counts.done + counts.blocked
}

/** One reason a round's jobs stopped, and how many of them stopped for it. */
export type PrescreenFailure = {
  /** `AppError.toLogLine()` as the drain recorded it, or the sentence below when it did not. */
  readonly error: string
  readonly count: number
}

/**
 * How many distinct failures the panel shows before it stops listing them.
 *
 * Three, because a round that stopped usually stopped for ONE reason (the rubric the model
 * API rejects, a missing key, a base that is throttling) and the list exists to name that
 * reason, not to reproduce the log. `wrangler tail` is where the other thirty live.
 */
export const PRESCREEN_FAILURE_SAMPLE = 3

/**
 * Why this round's jobs stopped, grouped, most common first.
 *
 * Only the STOPPED ones. A job that failed with attempts left is going to be retried on the
 * next tick and reporting its error would be reporting a state the organizer is not in yet.
 *
 * A stopped row with no `error` is not dropped: that is precisely the isolate that was
 * cancelled between stamping the attempt and writing the outcome, so it is the one failure
 * that never writes a reason, and dropping it would leave a badge saying two jobs stopped
 * over a list explaining one.
 */
export function prescreenFailures(
  jobs: readonly AiPrescreenJob[],
  limit: number = PRESCREEN_FAILURE_SAMPLE,
): readonly PrescreenFailure[] {
  const counted = new Map<string, number>()
  for (const job of jobs) {
    if (!prescreenStopped(job)) continue
    const reason =
      job.error === undefined || job.error.trim() === ''
        ? 'No reason was recorded. The run was cancelled before it could report one.'
        : job.error
    counted.set(reason, (counted.get(reason) ?? 0) + 1)
  }

  return (
    [...counted]
      .map(([error, count]) => ({ error, count }))
      // Count first, then the text, so two reasons with one job each come out in the same
      // order on every render rather than in whatever order Airtable listed the rows.
      .sort((left, right) => right.count - left.count || left.error.localeCompare(right.error))
      .slice(0, Math.max(0, limit))
  )
}
