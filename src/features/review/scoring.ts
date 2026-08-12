// Score aggregation for submission review (BUILD_SPEC section 5.4): a weighted
// mean per review, then a mean of those across reviewers, with the reviewer
// count carried alongside so a 1-review average is never presented as if it had
// the standing of a 5-review one. The count is not decoration; it is the only
// thing that stops the admin table from ranking a submission one reviewer liked
// above one that three reviewers agreed on.
//
// Pure and total. No clock, no I/O, no throwing: every degenerate rubric a
// round can be configured into has an answer here, because this runs inside a
// cached read where an exception would take out the whole Abstracts table.

import type { ReviewRecommendation } from '@/constants/status'
import type { Criterion } from '@/types/domain'

/**
 * The parts of a `Review` (`@/types/domain`) this module reads. Narrow on
 * purpose: taking the full record would drag the review feature's Airtable
 * shape into a module that only does arithmetic, and every test would then have
 * to invent ids and timestamps to say something about a mean.
 */
export type ScoredReview = {
  scores: Readonly<Record<string, number>>
  recommendation?: ReviewRecommendation
  /**
   * The reviewer declared a conflict of interest. Optional so callers that predate
   * recusal keep compiling, and read as `false` when absent.
   */
  recused?: boolean
}

export type ReviewScore = {
  /**
   * A 0-1 fraction, not a raw score, and `undefined` when nothing contributed.
   * Callers format it (the table shows a percent).
   */
  weightedMean: number | undefined
  /** How many criteria actually fed the mean. See `countedCriteria` below. */
  usedCriteria: number
}

export type SubmissionScore = {
  average: number | undefined
  reviewCount: number
  recommendations: Record<ReviewRecommendation, number>
}

/**
 * Criteria are normalised to a 0-1 fraction of their own range before weighting.
 * This is the judgment call in the module: a round can mix a 1-5 slider with a
 * 0-100 field, and averaging those raw would let the 0-100 criterion dominate by
 * two orders of magnitude regardless of the weight an organizer configured.
 * Weight is then the only thing that decides influence, which is what the
 * organizer thinks they are setting when they type it.
 *
 * Out-of-range scores are clamped, not rejected. Airtable enforces no bounds and
 * criteria ranges are editable after reviews land, so a stored 7 against a
 * criterion later narrowed to 1-5 is a normal history, not corruption. Rejecting
 * would delete a whole submission's average over one stale cell; clamping
 * degrades exactly one criterion and leaves the decision data intact.
 *
 * Only called for `numeric` criteria (see `countedCriteria`). A `numeric` range is
 * authored as a slider, where a reviewer dragging right always means "more of this
 * quality", so ascending-equals-better is not a guess for that kind, it is what a
 * slider IS.
 */
function fraction(criterion: Criterion, raw: number): number {
  const clamped = Math.min(Math.max(raw, criterion.min), criterion.max)
  return (clamped - criterion.min) / (criterion.max - criterion.min)
}

/**
 * A criterion only counts when it is `numeric`, has a score, a positive weight, and
 * a range wider than zero.
 *
 * The absent-score rule matters most: treating a skipped criterion as 0 would
 * make a reviewer who left one field blank look like a reviewer who hated it, so
 * the criterion drops out of both the numerator and the denominator and the
 * review is scored on what the reviewer actually answered. `usedCriteria`
 * reports how many that was, so a thin review is visible for the same reason a
 * thin submission is.
 *
 * Zero (or negative) weight means the organizer said this criterion does not
 * count, so it is excluded rather than silently promoted to equal footing, and
 * it is not counted in `usedCriteria` either: it contributed nothing. min === max
 * is a rubric that can only ever produce one value, so it carries no information
 * and dividing by its zero range would only manufacture a NaN.
 *
 * A `text` criterion is excluded by name rather than left to the absent-score rule.
 * Prose has no defensible position on a 0-1 scale, so there is nothing to normalise,
 * and the explicit test is what makes a stale numeric score left behind by a criterion
 * an organizer converted from a slider to free text stop counting.
 *
 * A `select` criterion is excluded the same way, and this is a correction rather than
 * the original design. `select` used to count here alongside `numeric`, on the theory
 * that a dropdown "aggregates exactly like a numeric one" because its options each
 * carry a number (see the stale comment on `CriterionKind` in `src/types/review.ts`,
 * outside this module's ownership, which still says so and needs the same fix). That
 * theory only holds if ascending option value also means "more favourable", and
 * nothing enforces that. An organizer building a "Recommendation" dropdown the way
 * anyone would type it, Accept=1 / Maybe=2 / Reject=3, gets a criterion where the
 * FLOOR of the range is the favourable answer. With that criterion weighted 25%, a
 * strong review that recommends Accept displayed 44%; the identical review
 * recommending Reject displayed about 69%. Nothing on screen said the scale had been
 * inverted, because from this module's side a select's `value` is just a number like
 * a slider's, and there is no way to tell "ascending is better" from "ascending is
 * worse" by looking at stored numbers alone.
 *
 * Rather than guess a direction (there is no reliable heuristic: label text like
 * "Accept" is free-form and unparseable, and option order is not a promise either),
 * a `select` criterion is treated the way `text` already is: it never reaches the
 * weighted mean. What the reviewer actually chose is not lost, it just is not
 * numeric here. `criterionOptionLabel` (`criterion-answer.ts`) reads the same stored
 * score back as the option's LABEL ("Accept"), which is unambiguous in a way a
 * normalised fraction of an undeclared direction can never be, and that is the
 * correct place to see a dropdown's answer.
 *
 * Existing reviews: a round with a `select` criterion will show a different
 * (usually lower, since a wrongly-inverted criterion typically has fewer chances to
 * inflate the average) weighted score after this change than it did before, because
 * that criterion's weight no longer contributes at all. That is not a side effect
 * to work around, it is the fix: the old number was arithmetic done on an assumption
 * this module cannot verify, so it was not a real number to begin with, only one
 * that happened to look like one. `plan-editor.ts`'s `weightShares` reports 0% for
 * every `select` criterion for the same reason, so the editor shows the same thing
 * this module now does.
 */
function countedCriteria(
  criteria: readonly Criterion[],
  scores: ReadonlyMap<string, number>,
): { weight: number; value: number }[] {
  const counted: { weight: number; value: number }[] = []
  for (const criterion of criteria) {
    if (criterion.kind !== 'numeric') continue
    const raw = scores.get(criterion.key)
    if (raw === undefined || criterion.weight <= 0 || criterion.max <= criterion.min) continue
    counted.push({ weight: criterion.weight, value: fraction(criterion, raw) })
  }
  return counted
}

export function scoreReview(review: ScoredReview, criteria: readonly Criterion[]): ReviewScore {
  // Via a Map because indexing a plain object by a criterion key is a dynamic
  // property read on data that came from Airtable, which the security lint
  // treats as injection and which would also hand back `number` for a key that
  // is not there.
  const scores = new Map(Object.entries(review.scores))
  const counted = countedCriteria(criteria, scores)

  let weightSum = 0
  let weightedSum = 0
  for (const entry of counted) {
    weightSum += entry.weight
    weightedSum += entry.weight * entry.value
  }

  return {
    weightedMean: weightSum > 0 ? weightedSum / weightSum : undefined,
    usedCriteria: counted.length,
  }
}

/**
 * Reviewers are weighted equally against each other. A round's weights describe
 * criteria, and nothing in the schema ranks one reviewer above another, so the
 * mean of the per-review means is the only defensible combination.
 */
export function scoreSubmission(
  reviews: readonly ScoredReview[],
  criteria: readonly Criterion[],
): SubmissionScore {
  let sum = 0
  let scored = 0
  const tally = new Map<ReviewRecommendation, number>()

  for (const review of reviews) {
    // A RECUSED review is not a vote. It is the reviewer saying they should not be
    // deciding this one, so it contributes neither a score nor a recommendation: counting
    // its abstention in the tally would make a conflict of interest look like an opinion,
    // and it is skipped before the recommendation block below for exactly that reason.
    if (review.recused === true) continue

    const { weightedMean } = scoreReview(review, criteria)
    if (weightedMean !== undefined) {
      sum += weightedMean
      scored += 1
    }
    // Tallied even when the review produced no mean: a reviewer who wrote a
    // comment and picked "no" without touching the sliders has still voted, and
    // the admin table shows that vote.
    const { recommendation } = review
    if (recommendation !== undefined) {
      tally.set(recommendation, (tally.get(recommendation) ?? 0) + 1)
    }
  }

  return {
    // `reviewCount` is the number of reviews behind the average, not the number
    // of rows: counting an empty review here would advertise depth the number
    // does not have, which is the exact thing the count exists to prevent.
    average: scored > 0 ? sum / scored : undefined,
    reviewCount: scored,
    // Spelled out rather than built from the vocabulary, so adding a fourth
    // recommendation is a type error here instead of a silently missing column.
    recommendations: {
      yes: tally.get('yes') ?? 0,
      no: tally.get('no') ?? 0,
      maybe: tally.get('maybe') ?? 0,
    },
  }
}
