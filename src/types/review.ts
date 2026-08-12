// The review graph: an evaluation plan, its rounds and their rubric, the committee,
// and the reviews themselves.
//
// Split out of domain.ts when the criterion types and the per-round settings landed
// and that file passed the size limit. Everything here is re-exported from domain.ts,
// so `import type { Round } from '@/types/domain'` still resolves and no call site had
// to move: this is a file boundary, not an API change.

import type { ReviewRecommendation, SubmissionRoundStatus } from '@/constants/status'
import type { RecordId } from '@/types/ids'

export type EvaluationPlan = {
  id: RecordId
  eventId: RecordId
  name: string
  status: 'draft' | 'active' | 'closed'
}

export type Round = {
  id: RecordId
  planId: RecordId
  eventId: RecordId
  name: string
  order: number
  criteria: readonly Criterion[]
  /** When this round opens and closes for its reviewers. Advisory, not enforced. */
  startsAt?: string
  endsAt?: string
  /** Hides author identity from reviewers on this round. */
  anonymous: boolean
  /**
   * The round's reviewer pool. EMPTY MEANS EVERYONE on the event, which is what an
   * unconfigured round has always meant and what every seeded base holds: making an
   * empty pool mean "nobody" would silently empty every existing round's committee
   * the moment this column landed.
   */
  reviewerIds: readonly RecordId[]
  /**
   * The most submissions one reviewer may hold in this round. Absent means no ceiling,
   * which is what every round held before the column existed.
   *
   * Enforced when assignments are PLANNED (`distribution.ts`) rather than when they are
   * written, so an organizer sees which submissions the cap left uncovered instead of a
   * write that half-succeeded. It is deliberately not enforced on the manual committee
   * path: a chair overriding their own ceiling for one abstract is a decision, not a
   * mistake, and a cap that blocks the escape hatch is a cap people work around by
   * raising it permanently.
   */
  maxPerReviewer?: number
}

/**
 * How a reviewer answers one criterion.
 *
 * `numeric` is a slider over min..max. `text` is prose and is NOT scored: it has no value to
 * normalise and no defensible place in a weighted mean.
 *
 * `select` is a dropdown whose options each carry a numeric value, and it is NOT scored either.
 * It used to aggregate exactly like a numeric one, and that was a real defect rather than a
 * simplification: normalising against the span of the option values assumes a higher value is
 * a better answer, and the most natural Recommendation anybody authors is
 * `Accept=1 / Maybe=2 / Reject=3`, which puts the best answer at the FLOOR. A strong review
 * recommending Accept displayed 44% where the identical review recommending Reject displayed
 * about 69%, with nothing on screen saying the scale had inverted. Nothing can infer the
 * favourable direction either: the labels are free text and the order is not a promise. So a
 * dropdown answer is categorical, shown to the chair as its label and left out of the mean.
 * See `countedCriteria` in @/features/review/scoring.
 */
export type CriterionKind = 'numeric' | 'select' | 'text'

export type CriterionOption = { label: string; value: number }

export type Criterion = {
  key: string
  label: string
  kind: CriterionKind
  /**
   * The scoring range. Kept on every criterion, including `select` and `text`, so that
   * `scoring.ts` needs no per-kind branch: a select's range is derived from its options
   * when it is authored, and a text criterion is excluded before the range is read.
   */
  min: number
  max: number
  weight: number
  /** `select` only: the choices, each with the score it contributes. */
  options?: readonly CriterionOption[]
}

export type ReviewTeam = { id: RecordId; eventId: RecordId; name: string; description?: string }

export type ReviewAssignment = {
  id: RecordId
  submissionId: RecordId
  roundId: RecordId
  reviewerId: RecordId
  viaTeamId?: RecordId
  assignedAt: string
  source: 'routing' | 'manual' | 'team'
}

export type SubmissionRound = {
  id: RecordId
  submissionId: RecordId
  roundId: RecordId
  status: SubmissionRoundStatus
  enteredAt: string
  decidedAt?: string
}

export type Review = {
  id: RecordId
  submissionId: RecordId
  roundId: RecordId
  reviewerId: RecordId
  scores: Record<string, number>
  /**
   * Answers to `text` criteria, keyed by `Criterion.key`. Separate from `scores`
   * because that blob is `Record<string, number>` all the way down to its Zod schema,
   * and separate from `comment` because the comment is about the submission while
   * these are about one criterion each.
   */
  notes: Readonly<Record<string, string>>
  /**
   * The reviewer declared a conflict of interest and will not score this one.
   *
   * A recused review is still a ROW. The alternative, deleting the assignment, would lose
   * the fact that this person was asked and let the chair reassign them to it again. It
   * contributes nothing to the aggregate and counts as handled rather than outstanding;
   * the reason is in `comment`.
   */
  recused: boolean
  comment?: string
  recommendation?: ReviewRecommendation
  updatedAt: string
}
