// One submission, one number. ABS-10.
//
// The rubric item is "an aggregate score per submission in a results table, sortable". The
// aggregate was there and the sort worked; what failed is that the same submission read
// three different numbers on three screens, because each surface picked its own round and
// only some of them knew to leave the AI pre-screen out:
//
//   - the Abstracts table pinned every row to the plan's FIRST round, AI excluded (25%);
//   - the submission detail pooled EVERY round's reviews and counted the AI (40%);
//   - the review-results export scored the round it was exporting (44%).
//
// `aggregateRoundFor` is the one rule all three now use, so these tests are about the rule
// rather than about any one screen: which round a submission's number belongs to, and that
// two callers given the same data cannot disagree.

import { describe, expect, it } from 'vitest'

import { aggregateRoundFor, ratingFor, ratingsBySubmission } from '@/features/review/ratings'
import type { Criterion, Review } from '@/types/domain'

const CRITERIA: readonly Criterion[] = [
  { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 1 },
]

const ROUNDS = [
  { id: 'round1', order: 1, criteria: CRITERIA },
  { id: 'round2', order: 2, criteria: CRITERIA },
]

const AI_ID = 'recAi'

function review(overrides: Partial<Review> & { id: string }): Review {
  return {
    submissionId: 'sub1',
    roundId: 'round1',
    reviewerId: 'human1',
    scores: {},
    notes: {},
    recused: false,
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('aggregateRoundFor', () => {
  it('reports the plan first round when nobody has reviewed the submission yet', () => {
    expect(aggregateRoundFor(ROUNDS, [])?.id).toBe('round1')
  })

  it('moves to the round just reviewed, which is the whole complaint', () => {
    const inRoundTwo = review({ id: 'r1', roundId: 'round2', scores: { relevance: 5 } })
    expect(aggregateRoundFor(ROUNDS, [inRoundTwo])?.id).toBe('round2')
  })

  it('reads the rounds in ORDER, not in the order the list happens to arrive in', () => {
    const shuffled = [ROUNDS[1], ROUNDS[0]]
    expect(aggregateRoundFor(shuffled, [])?.id).toBe('round1')
  })

  it('answers with nothing when the plan has no rounds at all', () => {
    expect(aggregateRoundFor([], [])).toBeUndefined()
  })
})

describe('the table and the detail header cannot disagree', () => {
  // What the eval run actually hit: a submission with one human review and two AI
  // pre-screen reviews, all in the first round.
  const human = review({ id: 'r-human', reviewerId: 'human1', scores: { relevance: 2 } })
  const ai = [
    review({ id: 'r-ai-1', reviewerId: AI_ID, scores: { relevance: 4 } }),
    review({ id: 'r-ai-2', reviewerId: AI_ID, roundId: 'round2', scores: { relevance: 5 } }),
  ]
  const reviews = [human, ...ai]
  const aiReviewerIds = new Set([AI_ID])

  it('scores the table row on the human review alone', () => {
    const cells = ratingsBySubmission({
      submissions: [{ id: 'sub1', reviewRequired: true }],
      reviews,
      rounds: ROUNDS,
      aiReviewerIds,
    })
    // 2 of a 1-5 range is 25%, and the count is 1. Pooling the AI's two would read 58% (3).
    expect(cells.get('sub1')).toMatchObject({ kind: 'scored', percent: 25, reviewCount: 1 })
  })

  it('gives the detail header the same number, from the same round and the same filter', () => {
    // This is `loadSubmissionDetail`'s own arithmetic, spelled out: pick the round with
    // `aggregateRoundFor` over the HUMAN reviews, then score that round.
    const round = aggregateRoundFor(
      ROUNDS,
      reviews.filter((entry) => !aiReviewerIds.has(entry.reviewerId)),
    )
    const header = ratingFor({
      reviewRequired: true,
      reviews: reviews.filter((entry) => entry.roundId === round?.id),
      criteria: round?.criteria ?? [],
      aiReviewerIds,
    })
    const table = ratingsBySubmission({
      submissions: [{ id: 'sub1', reviewRequired: true }],
      reviews,
      rounds: ROUNDS,
      aiReviewerIds,
    }).get('sub1')

    expect(header).toEqual(table)
  })

  it('does not let a round only the AI has touched become the round being reported', () => {
    // The AI pre-screened round two. The committee has not reached it, so the number stays
    // the committee's own from round one rather than jumping to a machine-only round.
    const round = aggregateRoundFor(
      ROUNDS,
      reviews.filter((entry) => !aiReviewerIds.has(entry.reviewerId)),
    )
    expect(round?.id).toBe('round1')
  })

  it('follows the committee into the next round once a person reviews there', () => {
    const inRoundTwo = review({
      id: 'r-human-2',
      roundId: 'round2',
      reviewerId: 'human1',
      scores: { relevance: 5 },
    })
    const cells = ratingsBySubmission({
      submissions: [{ id: 'sub1', reviewRequired: true }],
      reviews: [...reviews, inRoundTwo],
      rounds: ROUNDS,
      aiReviewerIds,
    })
    // Round two only, so 5 of 5, and one review behind it. Pinned to the first round this
    // stayed at 25% however much of round two the committee got through.
    expect(cells.get('sub1')).toMatchObject({ kind: 'scored', percent: 100, reviewCount: 1 })
  })

  it('still says "not sent for review" rather than scoring a sessions row', () => {
    const cells = ratingsBySubmission({
      submissions: [{ id: 'sub1', reviewRequired: false }],
      reviews,
      rounds: ROUNDS,
      aiReviewerIds,
    })
    expect(cells.get('sub1')?.kind).toBe('not_required')
  })
})
