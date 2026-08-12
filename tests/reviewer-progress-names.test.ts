// A reviewer with no name must never render as a blank row.
//
// An AdminUsers row carries a name only once somebody has filled it in, so a member added
// by email and not yet signed in has none. Every evaluation surface read `row.name`
// straight through, which put `"", 2 of 3` in the progress list and an unlabelled checkbox
// in the reviewer pool.

import { describe, expect, it } from 'vitest'

import { reviewerDisplayName, reviewerProgress } from '@/features/review/reviewer-progress'

describe('reviewerDisplayName', () => {
  it('keeps the name when there is one', () => {
    expect(reviewerDisplayName({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe(
      'Ada Lovelace',
    )
  })

  it('falls back to the email when the name is blank', () => {
    expect(reviewerDisplayName({ name: '', email: 'ada@example.com' })).toBe('ada@example.com')
  })

  it('treats a whitespace-only name as no name', () => {
    expect(reviewerDisplayName({ name: '   ', email: 'ada@example.com' })).toBe('ada@example.com')
  })

  it('says No name yet when there is no email either', () => {
    expect(reviewerDisplayName({ name: '', email: '' })).toBe('No name yet')
  })
})

describe('reviewerProgress names', () => {
  const reviewers = [
    { id: 'recA', name: '', email: 'ada@example.com' },
    { id: 'recB', name: 'Grace Hopper', email: 'grace@example.com' },
  ]

  it('never returns a blank name', () => {
    const rows = reviewerProgress({
      reviewers,
      assignments: [
        { roundId: 'recR', submissionId: 'recS1', reviewerId: 'recA' },
        { roundId: 'recR', submissionId: 'recS2', reviewerId: 'recA' },
      ],
      reviews: [{ roundId: 'recR', submissionId: 'recS1', reviewerId: 'recA' }],
      roundId: 'recR',
    })

    expect(rows.map((row) => row.name)).toEqual(['ada@example.com', 'Grace Hopper'])
    // The email fallback is a display name only: the address itself is untouched, because
    // the reminder is addressed from it.
    expect(rows[0]?.email).toBe('ada@example.com')
  })

  it('sorts a nameless reviewer by what is shown rather than by an empty string', () => {
    // Both at 0 of 0, so the tie breaks on the displayed name: `Ada` before `zoe@`.
    const rows = reviewerProgress({
      reviewers: [
        { id: 'recZ', name: '', email: 'zoe@example.com' },
        { id: 'recA', name: 'Ada Lovelace', email: 'ada@example.com' },
      ],
      assignments: [],
      reviews: [],
    })

    expect(rows.map((row) => row.name)).toEqual(['Ada Lovelace', 'zoe@example.com'])
  })
})
