// The Abstracts table's Ratings cell, decided here rather than in a renderer.
//
// `scoreSubmission` (scoring.ts, do not edit) returns a 0-1 fraction and
// `undefined` when nothing contributed. `undefined` is NOT zero, and the
// difference is the whole point of this module: three states that a naive
// `average ?? 0` would collapse into one.
//
//   - `not_required`: the row is `reviewRequired: false`, a sessions-form or manual
//     entry that was never meant to go through review (BUILD_SPEC section 5.1b).
//     Rendering 0% here would read as "the committee hated the sponsor keynote".
//   - `none`: review was expected and nobody has scored it yet. Also 0%-looking if
//     you are careless, and it is the opposite signal: it needs reviewers, not a
//     decision.
//   - `scored`: a real weighted mean, carried with the review count, because a
//     91% from one reviewer must not outrank an 84% three reviewers agreed on.
//
// Pure and total, because it runs inside a cached read where a throw would take
// out the whole table.

import type { ReviewRecommendation } from '@/constants/status'
import { scoreSubmission } from '@/features/review/scoring'
import type { Criterion, Review } from '@/types/domain'

export type RatingCell =
  | { readonly kind: 'not_required' }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'scored'
      /** 0-100, rounded. The table shows a percent; scoring.ts returns a fraction. */
      readonly percent: number
      readonly reviewCount: number
      readonly recommendations: Readonly<Record<ReviewRecommendation, number>>
    }

/**
 * Placeholder copy. Deliberately two different strings: the parity audit renders an
 * empty cell as "-", and "n/a" says something stronger, that no reviewer was ever
 * asked. Neither is a dash character wider than a hyphen.
 */
export const RATING_PLACEHOLDER: Readonly<Record<'none' | 'not_required', string>> = {
  none: '-',
  not_required: 'n/a',
}

export const RATING_HELP: Readonly<Record<'none' | 'not_required', string>> = {
  none: 'No reviews yet.',
  not_required: 'Not sent for review. This submission was confirmed without one.',
}

/**
 * Which reviews the AI pre-screen wrote, and whether they count.
 *
 * BUILD_SPEC 5.4: an AI review is "clearly labeled, never counted in the human average by
 * default (toggle to include)". The filter is HERE rather than in `scoring.ts`, which is
 * marked do-not-edit and whose arithmetic is right either way: excluding a reviewer is a
 * decision about whose opinion is in the number, not about how the number is computed.
 *
 * `aiReviewerIds` is a set rather than one id because the caller resolves it from
 * AdminUsers and an id it cannot resolve should mean "nothing to exclude", not a crash.
 * Empty plus `includeAi: false` therefore excludes nothing, which is the honest answer: a
 * caller that has not told this module which reviewer is the AI has no AI reviews as far
 * as this module can tell.
 */
export type AiReviewFilter = {
  readonly aiReviewerIds?: ReadonlySet<string>
  /** Defaults to false. The Evaluation panel's toggle is what sets it true. */
  readonly includeAi?: boolean
}

export function humanReviews(
  reviews: readonly Review[],
  filter: AiReviewFilter | undefined,
): readonly Review[] {
  const ids = filter?.aiReviewerIds
  if (filter?.includeAi === true || ids === undefined || ids.size === 0) return reviews
  return reviews.filter((review) => !ids.has(review.reviewerId))
}

export type RatingInput = AiReviewFilter & {
  readonly reviewRequired: boolean
  readonly reviews: readonly Review[]
  readonly criteria: readonly Criterion[]
}

export function ratingFor({ reviewRequired, reviews, criteria, ...ai }: RatingInput): RatingCell {
  // Checked before the arithmetic, not after: a sessions-form row can still have a
  // stray review row (an admin scored it out of curiosity) and it must still read
  // as "not sent for review", because that is what the column is telling the
  // organizer about their own process.
  if (!reviewRequired) return { kind: 'not_required' }

  // Filtered before the arithmetic, so `reviewCount` reports the humans behind the
  // average. Counting an AI review there would advertise depth the committee never had,
  // which is the exact thing the count exists to prevent (scoring.ts).
  const score = scoreSubmission(humanReviews(reviews, ai), criteria)
  if (score.average === undefined) return { kind: 'none' }

  return {
    kind: 'scored',
    percent: Math.round(score.average * 100),
    reviewCount: score.reviewCount,
    recommendations: score.recommendations,
  }
}

/** Grouped once per event read rather than filtered per row inside the renderer. */
export function reviewsBySubmission(
  reviews: readonly Review[],
  roundId?: string,
): ReadonlyMap<string, readonly Review[]> {
  const grouped = new Map<string, Review[]>()
  for (const review of reviews) {
    if (roundId !== undefined && review.roundId !== roundId) continue
    const bucket = grouped.get(review.submissionId)
    if (bucket === undefined) {
      grouped.set(review.submissionId, [review])
    } else {
      bucket.push(review)
    }
  }
  return grouped
}

/** The parts of a `Round` the aggregate needs: which one it is, where it sits, its rubric. */
export type AggregateRound = {
  readonly id: string
  readonly order: number
  readonly criteria: readonly Criterion[]
}

/**
 * Which round a submission's headline aggregate reports on.
 *
 * ONE rule, used by every surface that shows the number, because three surfaces each
 * picking their own round is how the same submission came to read 25% in the Abstracts
 * table, 40% on its detail header and 44% in the review-results export.
 *
 * The rule is "the furthest round this submission has actually been reviewed in", falling
 * back to the plan's first round when nobody has reviewed it yet. Two things follow, and
 * both were reported against the old behaviour:
 *
 *   - The number INCLUDES the round just reviewed. Pinning the column to the plan's first
 *     round meant an organizer could run a whole second round and watch the aggregate
 *     never move.
 *   - Rubrics are never mixed. Each round has its own criteria and its own weights, so
 *     pooling reviews across rounds would average two different questions; the aggregate
 *     is always one round's, and the surfaces say which.
 *
 * `reviews` must be one submission's, already filtered to the reviews that count (the
 * caller applies `humanReviews`, so a round only the AI pre-screen has touched is not a
 * round the committee has reached).
 */
export function aggregateRoundFor<T extends AggregateRound>(
  rounds: readonly T[],
  reviews: readonly Review[],
): T | undefined {
  const ordered = [...rounds].sort((left, right) => left.order - right.order)
  const reviewed = new Set(reviews.map((review) => review.roundId))
  return [...ordered].reverse().find((round) => reviewed.has(round.id)) ?? ordered.at(0)
}

export type RatingsInput = AiReviewFilter & {
  readonly submissions: readonly { readonly id: string; readonly reviewRequired: boolean }[]
  readonly reviews: readonly Review[]
  /** The round the Ratings column reports on, normally the active plan's first. */
  readonly round?: { readonly id: string; readonly criteria: readonly Criterion[] } | undefined
  /**
   * The plan's rounds. Given these, the round is chosen PER SUBMISSION by
   * `aggregateRoundFor` and `round` is ignored, which is what keeps a table, a detail
   * header and an export from disagreeing about the same submission.
   */
  readonly rounds?: readonly AggregateRound[]
}

export function ratingsBySubmission({
  submissions,
  reviews,
  round,
  rounds,
  ...ai
}: RatingsInput): ReadonlyMap<string, RatingCell> {
  // Grouped across every round, because which round each row reports on is decided per
  // submission below. With no `rounds` the behaviour is the old one: `round` or nothing.
  const grouped = reviewsBySubmission(reviews)
  return new Map(
    submissions.map((submission) => {
      const mine = grouped.get(submission.id) ?? []
      const scoring =
        rounds === undefined ? round : aggregateRoundFor(rounds, humanReviews(mine, ai))
      return [
        submission.id,
        ratingFor({
          ...ai,
          reviewRequired: submission.reviewRequired,
          reviews: scoring === undefined ? [] : mine.filter((row) => row.roundId === scoring.id),
          criteria: scoring?.criteria ?? [],
        }),
      ]
    }),
  )
}

/**
 * Sort key for the Ratings column. `undefined` sorts last in both directions (see
 * abstracts-filter.ts), which is what keeps unscored rows from masquerading as the
 * worst-rated ones when an organizer sorts descending to find the strongest.
 */
export function ratingSortValue(cell: RatingCell): number | undefined {
  return cell.kind === 'scored' ? cell.percent : undefined
}

export function ratingText(cell: RatingCell): string {
  if (cell.kind === 'scored') return `${cell.percent}%`
  return cell.kind === 'none' ? RATING_PLACEHOLDER.none : RATING_PLACEHOLDER.not_required
}
