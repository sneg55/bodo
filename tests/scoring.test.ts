// Every expected number below is worked out by hand in a comment next to the
// assertion. Recomputing the weighted mean in the test would only assert that
// the test and the module share a bug, which is the failure mode these numbers
// exist to catch.

import { describe, expect, it } from 'vitest'

import { scoreReview, scoreSubmission } from '@/features/review/scoring'
import type { Criterion } from '@/types/domain'

/** 1-5 slider, 0-100 field, 0-10 field: three ranges, three unequal weights. */
const CRITERIA: readonly Criterion[] = [
  { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 3 },
  { key: 'originality', label: 'Originality', kind: 'numeric', min: 0, max: 100, weight: 1 },
  { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 0, max: 10, weight: 2 },
]

/** Two criteria of one range, so a missing score is the only variable. */
const TWO: readonly Criterion[] = [
  { key: 'depth', label: 'Depth', kind: 'numeric', min: 0, max: 10, weight: 1 },
  { key: 'impact', label: 'Impact', kind: 'numeric', min: 0, max: 10, weight: 3 },
]

describe('scoreReview', () => {
  it('normalises each criterion to its own range before weighting', () => {
    // relevance (4-1)/4 = 0.75, originality 80/100 = 0.8, clarity 5/10 = 0.5
    // (3 * 0.75 + 1 * 0.8 + 2 * 0.5) / 6 = 4.05 / 6 = 0.675
    const result = scoreReview({ scores: { relevance: 4, originality: 80, clarity: 5 } }, CRITERIA)

    expect(result.weightedMean).toBeCloseTo(0.675, 12)
    expect(result.usedCriteria).toBe(3)
  })

  it('scores the bottom of every range as 0 and the top as 1', () => {
    const floor = scoreReview({ scores: { relevance: 1, originality: 0, clarity: 0 } }, CRITERIA)
    const ceiling = scoreReview(
      { scores: { relevance: 5, originality: 100, clarity: 10 } },
      CRITERIA,
    )

    expect(floor.weightedMean).toBe(0)
    expect(ceiling.weightedMean).toBe(1)
  })

  it('excludes a criterion with no score instead of reading it as 0', () => {
    // Only impact is scored: (3 * 0.5) / 3 = 0.5, depth's weight never counts.
    const missing = scoreReview({ scores: { impact: 5 } }, TWO)

    expect(missing.weightedMean).toBe(0.5)
    expect(missing.usedCriteria).toBe(1)
  })

  it('gives a lower mean when a criterion is scored 0 than when it is absent', () => {
    // Explicit zero: (1 * 0 + 3 * 0.5) / 4 = 1.5 / 4 = 0.375
    const explicitZero = scoreReview({ scores: { depth: 0, impact: 5 } }, TWO)

    expect(explicitZero.weightedMean).toBe(0.375)
    expect(explicitZero.usedCriteria).toBe(2)
    expect(explicitZero.weightedMean).toBeLessThan(0.5)
  })

  it('clamps a score above its criterion max rather than rejecting the review', () => {
    // relevance 9 clamps to 5 (fraction 1), clarity -4 clamps to 0.
    const high = scoreReview({ scores: { relevance: 9 } }, CRITERIA)
    const low = scoreReview({ scores: { clarity: -4 } }, CRITERIA)

    expect(high.weightedMean).toBe(1)
    expect(low.weightedMean).toBe(0)
    expect(high.usedCriteria).toBe(1)
  })

  it('has no mean when every weight is zero', () => {
    const zeroWeights: readonly Criterion[] = [
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 0 },
      { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 0, max: 10, weight: 0 },
    ]

    const result = scoreReview({ scores: { relevance: 5, clarity: 10 } }, zeroWeights)

    expect(result.weightedMean).toBeUndefined()
    expect(result.usedCriteria).toBe(0)
  })

  it('ignores a single zero-weight criterion but keeps the weighted rest', () => {
    const mixed: readonly Criterion[] = [
      { key: 'depth', label: 'Depth', kind: 'numeric', min: 0, max: 10, weight: 0 },
      { key: 'impact', label: 'Impact', kind: 'numeric', min: 0, max: 10, weight: 3 },
    ]

    const result = scoreReview({ scores: { depth: 10, impact: 5 } }, mixed)

    expect(result.weightedMean).toBe(0.5)
    expect(result.usedCriteria).toBe(1)
  })

  it('has no mean when the criteria list is empty', () => {
    expect(scoreReview({ scores: { relevance: 4 } }, [])).toEqual({
      weightedMean: undefined,
      usedCriteria: 0,
    })
  })

  it('excludes a criterion whose min equals its max, which carries no information', () => {
    const degenerate: readonly Criterion[] = [
      { key: 'flat', label: 'Flat', kind: 'numeric', min: 3, max: 3, weight: 5 },
      { key: 'impact', label: 'Impact', kind: 'numeric', min: 0, max: 10, weight: 1 },
    ]

    const result = scoreReview({ scores: { flat: 3, impact: 5 } }, degenerate)

    expect(result.weightedMean).toBe(0.5)
    expect(result.usedCriteria).toBe(1)
  })

  it('ignores a score whose key is not a criterion of this round', () => {
    const result = scoreReview({ scores: { impact: 5, retired: 999 } }, TWO)

    expect(result.weightedMean).toBe(0.5)
    expect(result.usedCriteria).toBe(1)
  })

  it('does not mutate its inputs', () => {
    const scores = { relevance: 4, originality: 80, clarity: 5 }

    scoreReview({ scores }, CRITERIA)

    expect(scores).toEqual({ relevance: 4, originality: 80, clarity: 5 })
  })
})

// `select` criteria (dropdowns) have their own file: tests/scoring-select.test.ts.

describe('scoreSubmission', () => {
  it('averages two reviewers over three unequally weighted criteria', () => {
    // Reviewer A: (3 * 0.75 + 1 * 0.8 + 2 * 0.5) / 6 = 4.05 / 6
    // Reviewer B: relevance (2-1)/4 = 0.25, originality 0.5, clarity 0.9
    //             (3 * 0.25 + 1 * 0.5 + 2 * 0.9) / 6 = 3.05 / 6
    // Average:    (4.05 / 6 + 3.05 / 6) / 2 = 7.1 / 12 = 0.59166666666...
    const result = scoreSubmission(
      [
        { scores: { relevance: 4, originality: 80, clarity: 5 }, recommendation: 'yes' },
        { scores: { relevance: 2, originality: 50, clarity: 9 }, recommendation: 'maybe' },
      ],
      CRITERIA,
    )

    expect(result.average).toBeCloseTo(7.1 / 12, 12)
    expect(result.reviewCount).toBe(2)
    expect(result.recommendations).toEqual({ yes: 1, no: 0, maybe: 1 })
  })

  it('reports no average and no reviewers when nobody has reviewed', () => {
    expect(scoreSubmission([], CRITERIA)).toEqual({
      average: undefined,
      reviewCount: 0,
      recommendations: { yes: 0, no: 0, maybe: 0 },
    })
  })

  it('keeps a one-review average visibly thin via reviewCount', () => {
    const thin = scoreSubmission([{ scores: { impact: 5, depth: 0 } }], TWO)

    expect(thin.average).toBe(0.375)
    expect(thin.reviewCount).toBe(1)
  })

  it('distinguishes a genuine 0 average from nobody reviewing', () => {
    const terrible = scoreSubmission([{ scores: { depth: 0, impact: 0 } }], TWO)

    expect(terrible.average).toBe(0)
    expect(terrible.reviewCount).toBe(1)
  })

  it('counts only reviews that produced a mean, but tallies every recommendation', () => {
    const result = scoreSubmission(
      [
        { scores: { impact: 5 }, recommendation: 'yes' },
        // Comment-only review: a recommendation, no usable scores.
        { scores: {}, recommendation: 'no' },
      ],
      TWO,
    )

    expect(result.average).toBe(0.5)
    expect(result.reviewCount).toBe(1)
    expect(result.recommendations).toEqual({ yes: 1, no: 1, maybe: 0 })
  })

  it('has no average when the criteria list is empty, whatever the reviewers said', () => {
    const result = scoreSubmission(
      [{ scores: { impact: 5 }, recommendation: 'yes' }, { scores: { impact: 9 } }],
      [],
    )

    expect(result.average).toBeUndefined()
    expect(result.reviewCount).toBe(0)
    expect(result.recommendations).toEqual({ yes: 1, no: 0, maybe: 0 })
  })

  it('tallies repeated recommendations and leaves absent ones at zero', () => {
    const result = scoreSubmission(
      [
        { scores: { impact: 10 }, recommendation: 'no' },
        { scores: { impact: 0 }, recommendation: 'no' },
        { scores: { impact: 5 } },
      ],
      TWO,
    )

    // (1 + 0 + 0.5) / 3 = 0.5
    expect(result.average).toBe(0.5)
    expect(result.reviewCount).toBe(3)
    expect(result.recommendations).toEqual({ yes: 0, no: 2, maybe: 0 })
  })

  it('excludes a recused review from the average entirely', () => {
    const result = scoreSubmission(
      [
        { scores: { impact: 10 } },
        // Scores left behind from before the conflict was declared. `saveReviewAction`
        // clears them on the way in; this is the second line of defence, and it covers a
        // row written before recusal existed.
        { scores: { impact: 0 }, recused: true },
      ],
      TWO,
    )

    expect(result.average).toBe(1)
    expect(result.reviewCount).toBe(1)
  })

  it('does not tally a recused reviewer as a vote', () => {
    const result = scoreSubmission(
      [
        { scores: {}, recommendation: 'yes' },
        // A conflict of interest is not an opinion, so it must not reach the tally: a
        // recusal that counted would read as a committee member who disagreed.
        { scores: {}, recommendation: 'no', recused: true },
      ],
      TWO,
    )

    expect(result.recommendations).toEqual({ yes: 1, no: 0, maybe: 0 })
  })
})
