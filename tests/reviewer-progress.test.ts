// Per-reviewer completion.
//
// The cases worth pinning are the two an aggregate hides: two reviewers each half done
// versus one finished and one not started, which the round-level "6 of 12" cannot tell
// apart, and a reviewer with nothing assigned at all.

import { describe, expect, it } from 'vitest'

import { reviewerProgress, reviewersBehind } from '@/features/review/reviewer-progress'

const REVIEWERS = [
  { id: 'u1', name: 'Ada Byron', email: 'ada@example.com' },
  { id: 'u2', name: 'Chen Wu', email: 'chen@example.com' },
  { id: 'u3', name: 'Bea Lovelace', email: 'bea@example.com' },
]

const assign = (submissionId: string, reviewerId: string, roundId = 'r1') => ({
  submissionId,
  reviewerId,
  roundId,
})

describe('reviewerProgress', () => {
  it('separates one-finished-one-idle from two-half-done, which the aggregate cannot', () => {
    const assignments = [
      assign('s1', 'u1'),
      assign('s2', 'u1'),
      assign('s1', 'u2'),
      assign('s2', 'u2'),
    ]

    const lopsided = reviewerProgress({
      reviewers: REVIEWERS.slice(0, 2),
      assignments,
      reviews: [assign('s1', 'u1'), assign('s2', 'u1')],
    })
    const even = reviewerProgress({
      reviewers: REVIEWERS.slice(0, 2),
      assignments,
      reviews: [assign('s1', 'u1'), assign('s1', 'u2')],
    })

    // Both are "2 of 4 reviews in" at the round level.
    expect(lopsided.map((row) => row.percent)).toEqual([0, 100])
    expect(even.map((row) => row.percent)).toEqual([50, 50])
  })

  it('lists a reviewer with nothing assigned rather than dropping them', () => {
    const rows = reviewerProgress({
      reviewers: REVIEWERS,
      assignments: [assign('s1', 'u1')],
      reviews: [],
    })

    const idle = rows.find((row) => row.reviewerId === 'u3')
    // The case that means the assignment step was missed, not that somebody is slow.
    expect(idle).toMatchObject({ assigned: 0, reviewed: 0, outstanding: 0 })
  })

  it('reports zero rather than a hundred percent for a reviewer with no queue', () => {
    const rows = reviewerProgress({
      reviewers: [REVIEWERS[2]],
      assignments: [],
      reviews: [],
    })

    expect(rows[0].percent).toBe(0)
  })

  it('counts only the round asked for', () => {
    const rows = reviewerProgress({
      reviewers: [REVIEWERS[0]],
      assignments: [assign('s1', 'u1', 'r1'), assign('s2', 'u1', 'r2')],
      reviews: [assign('s1', 'u1', 'r1')],
      roundId: 'r1',
    })

    expect(rows[0]).toMatchObject({ assigned: 1, reviewed: 1, percent: 100 })
  })

  it('does not credit a review filed in another round', () => {
    const rows = reviewerProgress({
      reviewers: [REVIEWERS[0]],
      assignments: [assign('s1', 'u1', 'r2')],
      reviews: [assign('s1', 'u1', 'r1')],
      roundId: 'r2',
    })

    expect(rows[0]).toMatchObject({ reviewed: 0, outstanding: 1 })
  })

  it('puts the furthest behind first, then breaks ties on name for a stable order', () => {
    const rows = reviewerProgress({
      reviewers: REVIEWERS,
      assignments: [assign('s1', 'u1'), assign('s1', 'u2'), assign('s2', 'u2'), assign('s1', 'u3')],
      reviews: [],
    })

    expect(rows.map((row) => row.reviewerId)).toEqual(['u2', 'u1', 'u3'])
  })

  it('counts a recusal as handled, so nobody is chased for a score they declined to give', () => {
    const rows = reviewerProgress({
      reviewers: [REVIEWERS[0]],
      assignments: [assign('s1', 'u1'), assign('s2', 'u1')],
      reviews: [{ ...assign('s1', 'u1'), recused: true }],
    })

    expect(rows[0]).toMatchObject({ assigned: 2, reviewed: 1, recused: 1, outstanding: 1 })
  })

  it('reports recusals separately, because the chair still has a row to reassign', () => {
    const rows = reviewerProgress({
      reviewers: [REVIEWERS[0]],
      assignments: [assign('s1', 'u1')],
      reviews: [{ ...assign('s1', 'u1'), recused: true }],
    })

    // 100% done from the reviewer's side, and one submission short from the chair's.
    expect(rows[0]).toMatchObject({ percent: 100, recused: 1, outstanding: 0 })
  })

  it('picks out who a reminder would go to, excluding the idle, finished and recused', () => {
    const rows = reviewerProgress({
      reviewers: REVIEWERS,
      assignments: [assign('s1', 'u1'), assign('s1', 'u2')],
      reviews: [assign('s1', 'u1')],
    })

    expect(reviewersBehind(rows).map((row) => row.reviewerId)).toEqual(['u2'])
  })
})
