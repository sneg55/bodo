// Who reviews what, when nobody wants to tick forty checkboxes.
//
// The evaluation run found the assignment tooling adequate for a handful of abstracts and
// absent at scale: bulk select and one bulk-assign action, no per-reviewer ceiling and no
// way to spread a pile of submissions across a committee in one move (ABS-06). This is the
// spreading half. The ceiling is `Round.maxPerReviewer`, and it is enforced here rather
// than at the write, because a plan that silently exceeded the cap and a plan that reported
// which submissions it could not fill are the same number of database rows and very
// different things to look at.
//
// Pure and total, per the project rule about logic that is expensive to debug through the
// UI. Nothing here reads a clock or a random source: the same input produces the same
// assignment every time, which is what makes "run it, look at it, run it again" safe.

import type { RecordId } from '@/types/ids'

export type AssignmentPair = { readonly submissionId: RecordId; readonly reviewerId: RecordId }

/** A reviewer and how many submissions they hold in this round. */
export type ReviewerLoad = { readonly reviewerId: RecordId; readonly assigned: number }

export type DistributionInput = {
  /** The submissions to fill, in the order the organizer sees them. */
  readonly submissionIds: readonly RecordId[]
  /** The eligible pool, already narrowed to the round's reviewers by the caller. */
  readonly reviewerIds: readonly RecordId[]
  /**
   * What is already assigned in this round. Counted BOTH as a reviewer's existing load
   * and as a submission's existing cover, so re-running after adding five submissions
   * tops those five up instead of reassigning everything.
   */
  readonly existing: readonly AssignmentPair[]
  /** How many reviewers each submission should end up with. */
  readonly reviewersPerSubmission: number
  /** The per-reviewer ceiling for the round, existing load included. Absent means none. */
  readonly maxPerReviewer?: number
}

/** A submission the pool could not cover, and how far it got. */
export type ShortSubmission = {
  readonly submissionId: RecordId
  readonly assigned: number
  readonly wanted: number
}

export type DistributionPlan = {
  /** The rows to create. Empty when everything was already covered. */
  readonly pairs: readonly AssignmentPair[]
  /**
   * Submissions left under-covered, because the pool ran out of reviewers or every
   * remaining one was at their cap. Reported rather than thrown: an organizer who asked
   * for three reviewers on forty abstracts with a committee of four wants the plan AND
   * the shortfall, not a refusal.
   */
  readonly short: readonly ShortSubmission[]
  /** Every pool reviewer's load once the plan is applied, in pool order. */
  readonly loads: readonly ReviewerLoad[]
}

/** A count from the UI or a Server Action argument, forced to a usable whole number. */
function whole(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

/**
 * Spread submissions across a reviewer pool, evenly and within the cap.
 *
 * Least-loaded-first, ties broken by the reviewer's position in the pool, so the result is
 * deterministic and the first reviewer in the list is not quietly favoured beyond one
 * submission. A reviewer already assigned to a submission is never picked for it again,
 * which is what makes a second run a top-up rather than a duplicate.
 */
export function distributeAssignments(input: DistributionInput): DistributionPlan {
  const pool = [...new Set(input.reviewerIds)]
  const wanted = whole(input.reviewersPerSubmission, 0)
  // `undefined` and a negative both mean "no ceiling". Zero does NOT: an organizer who
  // types 0 has said nobody may take anything, and reporting every submission as short is
  // a truer answer than ignoring the number they typed.
  const cap = input.maxPerReviewer === undefined ? undefined : whole(input.maxPerReviewer, 0)

  const load = new Map<RecordId, number>()
  const cover = new Map<RecordId, Set<RecordId>>()
  for (const pair of input.existing) {
    load.set(pair.reviewerId, (load.get(pair.reviewerId) ?? 0) + 1)
    const held = cover.get(pair.submissionId) ?? new Set<RecordId>()
    held.add(pair.reviewerId)
    cover.set(pair.submissionId, held)
  }

  const pairs: AssignmentPair[] = []
  const short: ShortSubmission[] = []

  for (const submissionId of new Set(input.submissionIds)) {
    const held = cover.get(submissionId) ?? new Set<RecordId>()

    while (held.size < wanted) {
      const pick = leastLoaded(pool, load, held, cap)
      if (pick === undefined) break
      held.add(pick)
      load.set(pick, (load.get(pick) ?? 0) + 1)
      pairs.push({ submissionId, reviewerId: pick })
    }

    // Measured after the loop, so a submission that was already covered by an earlier run
    // is not reported as short and one the pool could only half-fill is.
    if (held.size < wanted) {
      short.push({ submissionId, assigned: held.size, wanted })
    }
  }

  return {
    pairs,
    short,
    loads: pool.map((reviewerId) => ({ reviewerId, assigned: load.get(reviewerId) ?? 0 })),
  }
}

/**
 * The next reviewer to hand work to, or `undefined` when nobody is eligible.
 *
 * Eligibility is two tests and they are different failures: already on this submission
 * (fine, pick somebody else) and at the cap (fine, pick somebody else). Neither is an
 * error, which is why this returns an absence rather than throwing.
 */
function leastLoaded(
  pool: readonly RecordId[],
  load: ReadonlyMap<RecordId, number>,
  held: ReadonlySet<RecordId>,
  cap: number | undefined,
): RecordId | undefined {
  let best: RecordId | undefined
  let bestLoad = Number.POSITIVE_INFINITY

  for (const reviewerId of pool) {
    if (held.has(reviewerId)) continue
    const current = load.get(reviewerId) ?? 0
    if (cap !== undefined && current >= cap) continue
    // Strictly less than, so an equal load leaves the earlier reviewer in place and the
    // pool order is the tie-break. `>=` here would walk the pool backwards on every tie.
    if (current < bestLoad) {
      best = reviewerId
      bestLoad = current
    }
  }

  return best
}
