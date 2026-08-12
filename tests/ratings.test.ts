import { describe, expect, it } from 'vitest'

import {
  RATING_PLACEHOLDER,
  ratingFor,
  ratingSortValue,
  ratingsBySubmission,
  ratingText,
  reviewsBySubmission,
} from '@/features/review/ratings'
import type { Criterion, Review } from '@/types/domain'

const CRITERIA: readonly Criterion[] = [
  { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
  { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 1, max: 5, weight: 1 },
]

function review(overrides: Partial<Review> & { id: string }): Review {
  return {
    submissionId: 'sub1',
    roundId: 'round1',
    reviewerId: 'user1',
    scores: {},
    notes: {},
    recused: false,
    updatedAt: '2026-08-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('ratings', () => {
  it('renders a placeholder, never a zero, when nobody has reviewed yet', () => {
    const cell = ratingFor({ reviewRequired: true, reviews: [], criteria: CRITERIA })
    expect(cell.kind).toBe('none')
    expect(ratingText(cell)).toBe(RATING_PLACEHOLDER.none)
    expect(ratingSortValue(cell)).toBeUndefined()
  })

  it('renders a different placeholder for a row that was never sent for review', () => {
    const cell = ratingFor({ reviewRequired: false, reviews: [], criteria: CRITERIA })
    expect(cell.kind).toBe('not_required')
    expect(ratingText(cell)).toBe(RATING_PLACEHOLDER.not_required)
    // The two placeholders must not be the same string, or a sessions row and an
    // unreviewed abstract read identically, which is what section 5.1b rules out.
    expect(RATING_PLACEHOLDER.not_required).not.toBe(RATING_PLACEHOLDER.none)
  })

  it('keeps reviewRequired=false as a placeholder even when a stray review exists', () => {
    const cell = ratingFor({
      reviewRequired: false,
      reviews: [review({ id: 'r1', scores: { relevance: 5, clarity: 5 } })],
      criteria: CRITERIA,
    })
    expect(cell.kind).toBe('not_required')
  })

  it('reports a weighted percent with the review count behind it', () => {
    const cell = ratingFor({
      reviewRequired: true,
      reviews: [
        review({ id: 'r1', scores: { relevance: 5, clarity: 5 }, recommendation: 'yes' }),
        review({ id: 'r2', reviewerId: 'user2', scores: { relevance: 1, clarity: 1 } }),
      ],
      criteria: CRITERIA,
    })
    // Both reviews are at an extreme of the range, so the mean of the two fractions is 0.5.
    expect(cell).toMatchObject({ kind: 'scored', percent: 50, reviewCount: 2 })
    if (cell.kind === 'scored') expect(cell.recommendations.yes).toBe(1)
  })

  it('scores on what the reviewer answered, not on what they skipped', () => {
    const partial = ratingFor({
      reviewRequired: true,
      reviews: [review({ id: 'r1', scores: { relevance: 5 } })],
      criteria: CRITERIA,
    })
    expect(partial).toMatchObject({ kind: 'scored', percent: 100 })
  })

  it('groups reviews by submission and drops other rounds', () => {
    const grouped = reviewsBySubmission(
      [
        review({ id: 'r1' }),
        review({ id: 'r2', submissionId: 'sub2' }),
        review({ id: 'r3', roundId: 'round2' }),
      ],
      'round1',
    )
    expect(grouped.get('sub1')).toHaveLength(1)
    expect(grouped.get('sub2')).toHaveLength(1)
  })

  it('builds a cell for every submission, including ones with no reviews at all', () => {
    const cells = ratingsBySubmission({
      submissions: [
        { id: 'sub1', reviewRequired: true },
        { id: 'sub2', reviewRequired: true },
        { id: 'sub3', reviewRequired: false },
      ],
      reviews: [review({ id: 'r1', scores: { relevance: 3, clarity: 3 } })],
      round: { id: 'round1', criteria: CRITERIA },
    })
    expect(cells.get('sub1')?.kind).toBe('scored')
    expect(cells.get('sub2')?.kind).toBe('none')
    expect(cells.get('sub3')?.kind).toBe('not_required')
  })

  it('falls back to no-reviews when the plan has no round to score against', () => {
    const cells = ratingsBySubmission({
      submissions: [{ id: 'sub1', reviewRequired: true }],
      reviews: [review({ id: 'r1', scores: { relevance: 5 } })],
      round: undefined,
    })
    expect(cells.get('sub1')?.kind).toBe('none')
  })
})
