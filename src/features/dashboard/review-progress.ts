// The Review progress card, ref 37: three stat tiles, a reviewer list, and the plan name.
//
// A sibling of home-view.ts rather than more of it, for the size reason that file's own
// header gives, and because this is the only part of the home that reads the review graph.
//
// The three tiles are counted here rather than in the page because each one is a different
// grain, and mixing them up is the classic dashboard bug: "Evaluated submissions" counts
// SUBMISSIONS with at least one saved review, while the third tile counts ASSIGNMENTS with
// none. Two reviewers scoring the same talk is one evaluated submission and two reviews.
// Tested in tests/dashboard-review-progress.test.ts.
//
// That third tile is labelled "Reviews not started" and ref 37 labels it "Reviews in progress".
// The count did not change and neither did this file's arithmetic; only the words did, and
// HomeReview.tsx holds the reason.

import { reviewerDisplayName } from '@/features/review/reviewer-progress'
import type { EvaluationPlan, RecordId, Review, ReviewAssignment, Round } from '@/types/domain'

export type ReviewerProgress = {
  id: RecordId
  /** Never blank. See `reviewerDisplayName`, which is the one place that rule lives. */
  name: string
  assigned: number
  reviewed: number
}

export type ReviewProgressView = {
  /** Ref 37's "Evaluation 2.0 plans" tile. */
  plans: number
  evaluatedSubmissions: number
  /** Assignments with no saved review. The tile over it reads "Reviews not started". */
  reviewsInProgress: number
  /**
   * Every assignment in the plan. Not a tile: it is what tells the card whether a
   * "Reviews not started" of 0 means nothing has been assigned yet or the committee is
   * finished, which are opposite states and would otherwise render identically.
   */
  assigned: number
  /**
   * Ref 37's "Most active plan:" line. Absent unless a plan is genuinely ACTIVE.
   *
   * `getActivePlan` deliberately falls back to the first plan when none is active, so an event
   * whose only plan is closed still gets a usable Evaluation surface. That fallback is right
   * there and wrong here: naming a closed plan as the most active one states something untrue
   * on the dashboard. The tiles and reviewer rows stay, because those counts are real; only
   * the claim about which plan is current is withheld. Found by Codex review.
   */
  mostActivePlanName?: string
  reviewers: readonly ReviewerProgress[]
}

type AssignmentOf = Pick<ReviewAssignment, 'submissionId' | 'roundId' | 'reviewerId'>
type ReviewOf = Pick<Review, 'submissionId' | 'roundId' | 'reviewerId'>

/** `submissionId:roundId:reviewerId`, the tuple Reviews is unique on. */
function key(row: AssignmentOf | ReviewOf): string {
  return `${row.submissionId}:${row.roundId}:${row.reviewerId}`
}

export function reviewProgress(input: {
  plan?: Pick<EvaluationPlan, 'id' | 'name' | 'status'>
  /** The active plan's rounds. An empty list scopes everything out, deliberately. */
  rounds: readonly Pick<Round, 'id'>[]
  assignments: readonly AssignmentOf[]
  reviews: readonly ReviewOf[]
  /** `email` because a name is optional on AdminUsers: see `reviewerRows`. */
  reviewers: readonly { id: RecordId; name: string; email: string }[]
}): ReviewProgressView {
  const { plan } = input
  // Both lists arrive scoped to the EVENT, which can hold rounds from a closed plan too, so
  // they are narrowed to the active plan's rounds here. An empty round set therefore counts
  // nothing, which is correct: a plan with no rounds can have no work in it.
  const rounds = new Set(input.rounds.map((round) => round.id))
  const assignments = input.assignments.filter((row) => rounds.has(row.roundId))
  const reviews = input.reviews.filter((row) => rounds.has(row.roundId))

  const done = new Set(reviews.map(key))
  const byReviewer = new Map<RecordId, { assigned: number; reviewed: number }>()
  for (const assignment of assignments) {
    const tally = byReviewer.get(assignment.reviewerId) ?? { assigned: 0, reviewed: 0 }
    tally.assigned += 1
    if (done.has(key(assignment))) tally.reviewed += 1
    byReviewer.set(assignment.reviewerId, tally)
  }

  return {
    plans: plan === undefined ? 0 : 1,
    evaluatedSubmissions: new Set(reviews.map((review) => review.submissionId)).size,
    reviewsInProgress: assignments.filter((assignment) => !done.has(key(assignment))).length,
    assigned: assignments.length,
    // One active plan per event (`getActivePlan`), so the most active plan is that plan,
    // PROVIDED it is actually active. Ref 37 names it with both counters at 0, so this does
    // not wait for activity, only for the plan to be current.
    mostActivePlanName: plan?.status === 'active' ? plan.name : undefined,
    reviewers: reviewerRows(input.reviewers, byReviewer),
  }
}

/**
 * One row per reviewer who actually holds work, most outstanding first, so the card opens on
 * the person to chase rather than on the person who is done.
 *
 * An assignment whose reviewer has no membership left gets no row, because there is no name
 * to draw, the same call `listEventReviewers` makes about a membership pointing at a deleted
 * user. It stays in the tile counts above: dropping it there would hide unreviewed work.
 *
 * The label goes through `reviewerDisplayName` rather than reading `name` off the row, and it
 * is imported rather than reimplemented so this card cannot fall out of step with the three
 * evaluation surfaces that already use it. `AdminUsers.name` is blank until somebody signs in,
 * so a reviewer added by email and assigned work rendered here as an empty span above a
 * progress bar: a row that reads as broken rather than as a person to chase.
 */
function reviewerRows(
  reviewers: readonly { id: RecordId; name: string; email: string }[],
  byReviewer: ReadonlyMap<RecordId, { assigned: number; reviewed: number }>,
): readonly ReviewerProgress[] {
  return reviewers
    .flatMap((reviewer) => {
      const tally = byReviewer.get(reviewer.id)
      return tally === undefined
        ? []
        : [{ id: reviewer.id, name: reviewerDisplayName(reviewer), ...tally }]
    })
    .sort(
      (left, right) =>
        right.assigned - right.reviewed - (left.assigned - left.reviewed) ||
        left.name.localeCompare(right.name),
    )
}
