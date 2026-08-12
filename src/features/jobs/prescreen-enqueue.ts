// One press of `AI pre-screen`: decide what this round still needs, then write it.
//
// Separate from the Server Action, and with every boundary as an argument, for the reason
// `prescreen.ts` is separate from the cron route: the case worth pinning is an
// interleaving, and two admins pressing the button in the same second is not reachable
// through the UI.
//
// **The claim wraps the whole read-decide-write, not just the write.** Airtable has no
// uniqueness constraint, so two presses that both read an empty job list both create a full
// set of rows. The drain's own lease is per (round, submission) and only stops simultaneous
// SCORING, so the duplicate row is picked up on a later tick, pays for a second model call,
// overwrites the review `saveReview` is keyed on, and leaves the progress line reading
// "33 of 32" against a total it can never reach. Claimed per ROUND, because the round is
// the unit the button acts on.

import { prescreenTargets } from '@/features/jobs/prescreen-queue'
import { WORST_CASE_CALL_MS } from '@/services/airtable/scheduler'
import type { RecordId } from '@/types/domain'
import type { AiPrescreenJob } from '@/types/prescreen'

/**
 * How long one press holds the round.
 *
 * Sized against the retry policy rather than the happy path, which is what it used to be
 * and what made the claim quietly weaker than it read. The DAL honours a `Retry-After` and
 * retries, so one throttled Airtable call can run for `WORST_CASE_CALL_MS` on its own; a
 * lease cut to the happy-path enqueue (well under a second) expires while the press that
 * holds it is still queued behind a 429. Three of those covers the read phase, a create
 * batch and the reset write, each throttled the whole way.
 *
 * **It cannot be made perfectly safe, and this is the residual.** A round of tens of
 * submissions is several create batches, so a press throttled on every one of them can
 * still outlive any fixed number here. Raising it further used to have a cost of its own,
 * and no longer does: the press now releases the round as soon as its writes land, so the
 * number below is what a press that DIES is charged, not what a legitimate second press
 * waits for after an organizer assigns more reviewers. What makes an overrun survivable
 * rather than duplicating the round is that the decision reads UNCACHED
 * (`listPrescreenJobsUncached`): a second holder that arrives after
 * the winner's creates sees them and skips. What neither closes is the two presses
 * interleaving mid-flight, where the second read lands between the winner's read and its
 * create, and that window is real.
 */
export const PRESCREEN_ENQUEUE_LEASE_MS = 3 * WORST_CASE_CALL_MS

export type PrescreenEnqueueDeps = {
  readonly eventId: RecordId
  readonly roundId: RecordId
  /** Whether this deployment's scoring will reach the model or the keyless sample. */
  readonly mocked: boolean
  loadAiReviewerId: () => Promise<RecordId>
  /** Uncached: a cached list here is how one submission ends up queued twice. */
  listAssignments: () => Promise<
    readonly { readonly submissionId: RecordId; readonly roundId: RecordId }[]
  >
  listReviews: () => Promise<
    readonly {
      readonly submissionId: RecordId
      readonly roundId: RecordId
      readonly reviewerId: RecordId
    }[]
  >
  /**
   * Uncached, and it is the read this whole claim exists to protect: the create-vs-skip
   * decision is made from it, so a list that predates another press's writes recreates
   * every row that press just made. See `PRESCREEN_ENQUEUE_LEASE_MS`.
   */
  listJobs: () => Promise<readonly AiPrescreenJob[]>
  createJobs: (input: {
    submissionIds: readonly RecordId[]
    queuedAt: string
  }) => Promise<{ created: number }>
  /** Sampled rows a live run supersedes, sent back to the head of the queue in place. */
  resetJobs: (jobIds: readonly RecordId[]) => Promise<void>
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /**
   * Hand the round back once this press has finished writing, so the lease is not also
   * the window in which a legitimate second press is refused. See `enqueuePrescreenRound`
   * for why it is not called on the failure path.
   */
  release: (key: string, holder: string) => Promise<{ released: boolean }>
  /** Unique per press: `claimOnce` re-grants to the same holder, so a shared one would
   * hand two simultaneous presses the same round. */
  holder: string
  now: () => string
}

export type PrescreenEnqueueResult = {
  /** Rows this press put in the queue, new and reset together. */
  readonly queued: number
  /**
   * Distinct submissions assigned in this round that were already covered. Distinct rather
   * than assignment rows: a committee of six would otherwise report six skips for one
   * abstract.
   */
  readonly skipped: number
  /** Another press holds the round. Not an error: their run covers this one. */
  readonly contended: boolean
}

export async function enqueuePrescreenRound(
  deps: PrescreenEnqueueDeps,
): Promise<PrescreenEnqueueResult> {
  const key = `prescreen:enqueue:${deps.roundId}`
  const claim = await deps.claim(key, deps.holder, PRESCREEN_ENQUEUE_LEASE_MS)
  if (!claim.granted) return { queued: 0, skipped: 0, contended: true }

  const [aiReviewerId, assignments, reviews, jobs] = await Promise.all([
    deps.loadAiReviewerId(),
    deps.listAssignments(),
    deps.listReviews(),
    deps.listJobs(),
  ])

  const targets = prescreenTargets({
    roundId: deps.roundId,
    aiReviewerId,
    mocked: deps.mocked,
    assignments,
    reviews,
    jobs,
  })

  // One instant for the whole batch, so a round queued together reads as one action rather
  // than forty timestamps a few milliseconds apart.
  const created =
    targets.create.length === 0
      ? 0
      : (await deps.createJobs({ submissionIds: targets.create, queuedAt: deps.now() })).created
  if (targets.reset.length > 0) await deps.resetJobs(targets.reset)

  // Both writes are on the base, so the round no longer needs holding: a second press from
  // here on reads them and skips. Without this the lease was also the window in which an
  // organizer who assigns more reviewers and presses again is told the round is already
  // being queued, minutes after it finished.
  //
  // Only on the way out, and not in a `finally`. A write that REJECTED can still have
  // landed, and a second press deciding create-vs-skip while that is in the air is the
  // interleaving the claim exists to stop, so a failed press keeps the round until its
  // lease expires, which is where this stood before the release existed.
  await deps.release(key, deps.holder)

  const queued = created + targets.reset.length
  const assigned = new Set(
    assignments
      .filter((assignment) => assignment.roundId === deps.roundId)
      .map((assignment) => assignment.submissionId),
  ).size
  return { queued, skipped: assigned - queued, contended: false }
}
