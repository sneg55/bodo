// `select` (dropdown) criteria, split out of scoring.test.ts by the file-size limit.
//
// This is the regression suite for the bug an eval judge reverse-engineered from two
// displayed percentages: a "Recommendation" dropdown built the way anyone would build
// it, Accept=1 / Maybe=2 / Reject=3, put the FAVOURABLE answer at the FLOOR of the
// criterion's normalised range, because the aggregate assumed ascending value meant
// ascending favourability. `countedCriteria` in scoring.ts now excludes every `select`
// criterion from the weighted mean rather than guess a direction it cannot verify; see
// that function's doc comment for the full reasoning.

import { describe, expect, it } from 'vitest'

import { scoreReview } from '@/features/review/scoring'
import type { Criterion } from '@/types/domain'

describe('scoreReview, select criteria', () => {
  it('excludes a select criterion from the mean entirely, whichever way its values run', () => {
    // The regression this pins: a "Recommendation" dropdown authored the way anyone
    // would type it, Accept=1 / Maybe=2 / Reject=3. Treating that like a numeric range
    // (the old behaviour) put Accept at the FLOOR of the range, so a strong review
    // recommending Accept computed to 0.44 and the same review recommending Reject
    // computed to about 0.69, with nothing on screen to say the scale was inverted.
    // Excluding it means only `relevance` and `clarity` (weights 3 and 2) can count.
    const criteria: readonly Criterion[] = [
      { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 3 },
      { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 0, max: 10, weight: 2 },
      {
        key: 'recommendation',
        label: 'Recommendation',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 5,
        options: [
          { label: 'Accept', value: 1 },
          { label: 'Maybe', value: 2 },
          { label: 'Reject', value: 3 },
        ],
      },
    ]

    // relevance (5-1)/4 = 1, clarity 8/10 = 0.8. (3*1 + 2*0.8) / 5 = 4.6 / 5 = 0.92,
    // whichever option the reviewer picked for `recommendation`.
    const acceptsWell = scoreReview(
      { scores: { relevance: 5, clarity: 8, recommendation: 1 } },
      criteria,
    )
    const rejectsWell = scoreReview(
      { scores: { relevance: 5, clarity: 8, recommendation: 3 } },
      criteria,
    )

    expect(acceptsWell.weightedMean).toBeCloseTo(0.92, 12)
    expect(rejectsWell.weightedMean).toBeCloseTo(0.92, 12)
    expect(acceptsWell.weightedMean).toBe(rejectsWell.weightedMean)
    expect(acceptsWell.usedCriteria).toBe(2)
  })

  it('has no mean when every counted criterion is a select', () => {
    const criteria: readonly Criterion[] = [
      {
        key: 'recommendation',
        label: 'Recommendation',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 1,
        options: [
          { label: 'Accept', value: 1 },
          { label: 'Reject', value: 3 },
        ],
      },
    ]

    const result = scoreReview({ scores: { recommendation: 1 } }, criteria)

    expect(result.weightedMean).toBeUndefined()
    expect(result.usedCriteria).toBe(0)
  })

  it('ignores a select criterion with a zero weight the same as one with a positive weight', () => {
    // A `select` never counts regardless of what its stored weight says, which matters
    // for a round saved before this rule existed and still holds a nonzero weight.
    const criteria: readonly Criterion[] = [
      { key: 'depth', label: 'Depth', kind: 'numeric', min: 0, max: 10, weight: 1 },
      {
        key: 'recommendation',
        label: 'Recommendation',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 0,
        options: [
          { label: 'Accept', value: 1 },
          { label: 'Reject', value: 3 },
        ],
      },
    ]

    const zeroWeight = scoreReview({ scores: { depth: 5, recommendation: 1 } }, criteria)
    const positiveWeight = scoreReview(
      { scores: { depth: 5, recommendation: 1 } },
      criteria.map((criterion) =>
        criterion.kind === 'select' ? { ...criterion, weight: 9 } : criterion,
      ),
    )

    expect(zeroWeight.weightedMean).toBe(0.5)
    expect(positiveWeight.weightedMean).toBe(0.5)
    expect(zeroWeight.usedCriteria).toBe(1)
    expect(positiveWeight.usedCriteria).toBe(1)
  })
})
