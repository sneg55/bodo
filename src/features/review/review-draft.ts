// The shape a reviewer is editing, and how two edits inside one debounce window
// combine. Separate from the hook so the server action and the tests can both use it
// without importing a client module.

import { REVIEW_RECOMMENDATIONS, type ReviewRecommendation } from '@/constants/status'
import type { Criterion, Review } from '@/types/domain'

export type ReviewDraftState = {
  /** Keyed by `Criterion.key`. A criterion the reviewer skipped is absent, not 0. */
  readonly scores: Readonly<Record<string, number>>
  /** Answers to `text` criteria, also keyed by `Criterion.key`. */
  readonly notes: Readonly<Record<string, string>>
  /** The reviewer declared a conflict of interest. The reason goes in `comment`. */
  readonly recused: boolean
  readonly comment: string
  readonly recommendation?: ReviewRecommendation
}

export const EMPTY_REVIEW_DRAFT: ReviewDraftState = {
  scores: {},
  notes: {},
  recused: false,
  comment: '',
}

export function draftFromReview(review: Review | undefined): ReviewDraftState {
  if (review === undefined) return EMPTY_REVIEW_DRAFT
  return {
    scores: review.scores,
    notes: review.notes,
    recused: review.recused,
    comment: review.comment ?? '',
    recommendation: review.recommendation,
  }
}

/**
 * Scores merge key by key; everything else replaces.
 *
 * This is the whole reason `merge` is a parameter of the autosave queue rather than a
 * spread inside it. Two criteria nudged 300ms apart are one write, and a shallow
 * spread of `{ scores }` would make the second one erase the first.
 */
export function mergeReviewDraft(
  current: ReviewDraftState,
  patch: Partial<ReviewDraftState>,
): ReviewDraftState {
  return {
    scores: patch.scores === undefined ? current.scores : { ...current.scores, ...patch.scores },
    // Merged key by key for the same reason scores are: two free-text criteria typed
    // inside one debounce window are one write, and a shallow spread would lose the
    // first one.
    notes: patch.notes === undefined ? current.notes : { ...current.notes, ...patch.notes },
    recused: patch.recused ?? current.recused,
    comment: patch.comment ?? current.comment,
    recommendation: patch.recommendation ?? current.recommendation,
  }
}

/**
 * Keep only scores that belong to this round's rubric and sit inside their range.
 *
 * Applied on the way into the write, not on the way out of the input. A criterion
 * deleted from the round after a reviewer scored it must not keep being written back,
 * and a value outside its range would be clamped by `scoring.ts` on every read
 * forever rather than once here.
 */
export function sanitizeScores(
  scores: Readonly<Record<string, number>>,
  criteria: readonly Criterion[],
): Record<string, number> {
  const entries = new Map(Object.entries(scores))
  const kept: [string, number][] = []
  for (const criterion of criteria) {
    const raw = entries.get(criterion.key)
    if (raw === undefined || !Number.isFinite(raw)) continue
    kept.push([criterion.key, Math.min(Math.max(raw, criterion.min), criterion.max)])
  }
  return Object.fromEntries(kept)
}

/**
 * Keep only notes that belong to a `text` criterion in this round's rubric.
 *
 * The mirror of `sanitizeScores`, and it exists for the same reason: a criterion an
 * organizer converted from free text to a slider must stop having its prose written
 * back forever, and an empty box is an absence rather than a stored empty string.
 */
export function sanitizeNotes(
  notes: Readonly<Record<string, string>>,
  criteria: readonly Criterion[],
): Record<string, string> {
  const entries = new Map(Object.entries(notes))
  const kept: [string, string][] = []
  for (const criterion of criteria) {
    if (criterion.kind !== 'text') continue
    const raw = entries.get(criterion.key)
    if (raw === undefined || raw.trim() === '') continue
    kept.push([criterion.key, raw])
  }
  return Object.fromEntries(kept)
}

export function isRecommendation(value: string): value is ReviewRecommendation {
  return REVIEW_RECOMMENDATIONS.includes(value as ReviewRecommendation)
}

const RECOMMENDATION_LABELS: ReadonlyMap<ReviewRecommendation, string> = new Map([
  ['yes', 'Yes'],
  ['no', 'No'],
  ['maybe', 'Maybe'],
])

export function recommendationLabel(recommendation: ReviewRecommendation): string {
  return RECOMMENDATION_LABELS.get(recommendation) ?? recommendation
}
