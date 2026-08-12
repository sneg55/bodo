// Everything the evaluation plan editor renders, assembled server side.
//
// One read of each table and no per-round fan-out, which is what BUILD_SPEC 3.1 rules
// out: the counts below come from two lists filtered in code, not from a call per round.
//
// The counts are the part worth explaining. A round shows how many assignments and how
// many reviews it already holds, because those are the two numbers that decide what an
// organizer may safely change: a rubric edited after reviews have landed re-weights
// scores that were filed under the old one, and `deleteRound` refuses outright once
// either count is above zero. Showing them is what turns that refusal from a surprise
// into a warning the organizer read first.

import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
import type { EventReviewer } from '@/features/review/review-reads'
import {
  listAssignmentsForEvent,
  listEventReviewers,
  listReviewsForEvent,
} from '@/features/review/review-reads'
import { listEvaluationPlans, listRounds } from '@/services/airtable/queries'
import type { Criterion, EvaluationPlan, RecordId } from '@/types/domain'

export type PlanRoundView = {
  readonly id: RecordId
  readonly name: string
  readonly order: number
  readonly criteria: readonly Criterion[]
  readonly startsAt?: string
  readonly endsAt?: string
  readonly anonymous: boolean
  readonly reviewerIds: readonly RecordId[]
  /** The per-reviewer ceiling. Absent means none, which is what an unset column is. */
  readonly maxPerReviewer?: number
  /** Assignments in this round, across the committee. */
  readonly assignments: number
  /**
   * Reviews the COMMITTEE has filed in it. Editing the rubric re-weights every one of them.
   *
   * Human only, and that is the fix rather than a detail: this counted the AI pre-screen's
   * rows too while the Evaluation page next door excluded them, so a round the plan editor
   * called `4 assigned / 6 reviewed` was `2/4` on the surface reviewers actually work in.
   * One of those numbers is arithmetically impossible and the two screens contradicted each
   * other on the same round.
   */
  readonly reviews: number
  /** The AI pre-screen's rows in it, counted separately rather than folded in above. */
  readonly aiReviews: number
}

export type PlanView = {
  readonly plans: readonly EvaluationPlan[]
  /** The plan being edited: the active one, or the first, or none at all. */
  readonly plan?: EvaluationPlan
  readonly rounds: readonly PlanRoundView[]
  /** Everyone on the event who could be put in a round's reviewer pool. */
  readonly reviewers: readonly EventReviewer[]
}

export async function loadPlanView(eventId: RecordId, planId?: RecordId): Promise<PlanView> {
  const [plans, rounds, assignments, reviews, reviewers, aiReviewerId] = await Promise.all([
    listEvaluationPlans(eventId),
    listRounds(eventId),
    listAssignmentsForEvent(eventId),
    listReviewsForEvent(eventId),
    listEventReviewers(eventId),
    // Same tolerance every organizer-facing surface takes: a base that was never seeded for
    // the pre-screen has no AI reviewer, which is the normal state and not a failure.
    aiReviewerOrNone(),
  ])

  const plan =
    plans.find((candidate) => candidate.id === planId) ??
    plans.find((candidate) => candidate.status === 'active') ??
    plans.at(0)

  const assignmentsByRound = tally(assignments.map((row) => row.roundId))
  const isAi = (reviewerId: string) => aiReviewerId !== undefined && reviewerId === aiReviewerId
  const reviewsByRound = tally(
    reviews.filter((row) => !isAi(row.reviewerId)).map((row) => row.roundId),
  )
  const aiReviewsByRound = tally(
    reviews.filter((row) => isAi(row.reviewerId)).map((row) => row.roundId),
  )

  return {
    plans,
    plan,
    rounds:
      plan === undefined
        ? []
        : rounds
            .filter((round) => round.planId === plan.id)
            .map((round) => ({
              id: round.id,
              name: round.name,
              order: round.order,
              criteria: round.criteria,
              startsAt: round.startsAt,
              endsAt: round.endsAt,
              anonymous: round.anonymous,
              reviewerIds: round.reviewerIds,
              maxPerReviewer: round.maxPerReviewer,
              assignments: assignmentsByRound.get(round.id) ?? 0,
              reviews: reviewsByRound.get(round.id) ?? 0,
              aiReviews: aiReviewsByRound.get(round.id) ?? 0,
            }))
            .sort((left, right) => left.order - right.order),
    reviewers,
  }
}

function tally(keys: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}
