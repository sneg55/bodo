// Auto-distribution: the half of ABS-06 that spreads a pile of submissions across a
// committee. The cap is the other half and is exercised here too, because the ceiling only
// means anything at the moment it stops an assignment from being made.

import { describe, expect, it } from 'vitest'

import {
  type AssignmentPair,
  type DistributionInput,
  distributeAssignments,
} from '@/features/review/distribution'

const SUBS = ['recS1', 'recS2', 'recS3', 'recS4'] as const
const POOL = ['recR1', 'recR2', 'recR3'] as const

function plan(overrides: Partial<DistributionInput> = {}) {
  return distributeAssignments({
    submissionIds: SUBS,
    reviewerIds: POOL,
    existing: [],
    reviewersPerSubmission: 1,
    ...overrides,
  })
}

/** How many submissions each reviewer ended up holding, from the pairs alone. */
function tally(pairs: readonly AssignmentPair[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const pair of pairs) counts[pair.reviewerId] = (counts[pair.reviewerId] ?? 0) + 1
  return counts
}

describe('spreading work across a pool', () => {
  it('covers every submission and evens the load', () => {
    const result = plan({ submissionIds: ['a', 'b', 'c', 'd', 'e', 'f'] })

    expect(result.pairs).toHaveLength(6)
    expect(result.short).toEqual([])
    expect(tally(result.pairs)).toEqual({ recR1: 2, recR2: 2, recR3: 2 })
  })

  it('never gives one submission the same reviewer twice', () => {
    const result = plan({ reviewersPerSubmission: 3 })

    for (const submissionId of SUBS) {
      const reviewers = result.pairs
        .filter((pair) => pair.submissionId === submissionId)
        .map((pair) => pair.reviewerId)
      expect(new Set(reviewers).size).toBe(reviewers.length)
      expect(reviewers).toHaveLength(3)
    }
  })

  it('leaves the load within one of even when the split is not clean', () => {
    // Four submissions over three reviewers: somebody takes two. The point is that only
    // ONE somebody does, which is what a naive round-robin from index 0 also gets right
    // and what "assign everything to the first available reviewer" does not.
    const counts = Object.values(tally(plan().pairs))

    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('is deterministic, so running it twice looks the same as running it once', () => {
    expect(plan({ reviewersPerSubmission: 2 })).toEqual(plan({ reviewersPerSubmission: 2 }))
  })
})

describe('the per-reviewer cap', () => {
  it('stops assigning to a reviewer at the ceiling', () => {
    const result = plan({ submissionIds: ['a', 'b', 'c', 'd', 'e', 'f'], maxPerReviewer: 1 })

    expect(result.pairs).toHaveLength(3)
    for (const count of Object.values(tally(result.pairs))) expect(count).toBe(1)
  })

  it('reports the submissions it could not cover instead of quietly under-filling', () => {
    // This is the property that makes the cap usable. An organizer who sets a ceiling too
    // low needs to be told which abstracts nobody is reading, and the number is in the
    // plan rather than discovered six weeks later on the progress dashboard.
    const result = plan({ submissionIds: ['a', 'b', 'c', 'd'], maxPerReviewer: 1 })

    expect(result.short).toEqual([{ submissionId: 'd', assigned: 0, wanted: 1 }])
  })

  it('counts what a reviewer already holds against their ceiling', () => {
    // The cap is a ceiling on the ROUND, not on one run of this function. Two reviewers
    // are full from an earlier assignment, so only the third can take anything.
    const existing: readonly AssignmentPair[] = [
      { submissionId: 'old1', reviewerId: 'recR1' },
      { submissionId: 'old2', reviewerId: 'recR2' },
    ]
    const result = plan({ submissionIds: ['a', 'b'], existing, maxPerReviewer: 1 })

    expect(result.pairs).toEqual([{ submissionId: 'a', reviewerId: 'recR3' }])
    expect(result.short).toEqual([{ submissionId: 'b', assigned: 0, wanted: 1 }])
  })

  it('treats a cap of zero as nobody may take anything', () => {
    // Not folded into "no cap". An organizer who types 0 has said something, and silently
    // reading it as unlimited is the opposite of what they said.
    const result = plan({ maxPerReviewer: 0 })

    expect(result.pairs).toEqual([])
    expect(result.short).toHaveLength(SUBS.length)
  })

  it('leaves an absent cap unlimited', () => {
    const result = plan({ submissionIds: ['a', 'b', 'c', 'd', 'e'], reviewerIds: ['solo'] })

    expect(tally(result.pairs)).toEqual({ solo: 5 })
    expect(result.short).toEqual([])
  })
})

describe('re-running over work already assigned', () => {
  it('tops a partly covered submission up rather than starting again', () => {
    const existing: readonly AssignmentPair[] = [{ submissionId: 'a', reviewerId: 'recR1' }]
    const result = distributeAssignments({
      submissionIds: ['a'],
      reviewerIds: POOL,
      existing,
      reviewersPerSubmission: 2,
    })

    expect(result.pairs).toHaveLength(1)
    expect(result.pairs.at(0)?.reviewerId).not.toBe('recR1')
  })

  it('creates nothing when every submission is already at the target', () => {
    const existing: readonly AssignmentPair[] = SUBS.map((submissionId) => ({
      submissionId,
      reviewerId: 'recR1',
    }))
    const result = plan({ existing })

    expect(result.pairs).toEqual([])
    expect(result.short).toEqual([])
  })

  it('balances against existing load, not from zero', () => {
    // recR1 is carrying three from an earlier round of assignment. A fresh distribution
    // that ignored that would hand them a fourth before touching the idle reviewers.
    const existing: readonly AssignmentPair[] = ['x', 'y', 'z'].map((submissionId) => ({
      submissionId,
      reviewerId: 'recR1',
    }))
    const result = plan({ submissionIds: ['a', 'b'], existing })

    expect(result.pairs.map((pair) => pair.reviewerId)).toEqual(['recR2', 'recR3'])
  })

  it('reports a final load for every pool reviewer, idle ones included', () => {
    const result = plan({ submissionIds: ['a'] })

    expect(result.loads).toEqual([
      { reviewerId: 'recR1', assigned: 1 },
      { reviewerId: 'recR2', assigned: 0 },
      { reviewerId: 'recR3', assigned: 0 },
    ])
  })
})

describe('inputs that should not throw', () => {
  it('assigns nothing when the pool is empty', () => {
    const result = plan({ reviewerIds: [] })

    expect(result.pairs).toEqual([])
    expect(result.short).toHaveLength(SUBS.length)
    expect(result.loads).toEqual([])
  })

  it('assigns nothing when no submissions were selected', () => {
    expect(plan({ submissionIds: [] }).pairs).toEqual([])
  })

  it('ignores a duplicate submission or reviewer', () => {
    const result = distributeAssignments({
      submissionIds: ['a', 'a'],
      reviewerIds: ['recR1', 'recR1'],
      existing: [],
      reviewersPerSubmission: 1,
    })

    expect(result.pairs).toEqual([{ submissionId: 'a', reviewerId: 'recR1' }])
  })

  it('rounds a fractional target down rather than looping forever', () => {
    // A Server Action is reachable by POST with no page rendering, so 2.5 is a value this
    // can actually receive.
    expect(plan({ reviewersPerSubmission: 2.5 }).pairs).toHaveLength(SUBS.length * 2)
  })

  it('assigns nothing on a negative or non-finite target', () => {
    expect(plan({ reviewersPerSubmission: -3 }).pairs).toEqual([])
    expect(plan({ reviewersPerSubmission: Number.NaN }).pairs).toEqual([])
  })
})
