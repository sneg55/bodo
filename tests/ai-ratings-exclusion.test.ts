// Keeping the AI reviewer out of the human average.
//
// BUILD_SPEC 5.4 says a pre-screen review is "never counted in the human average by
// default". That is one filter with three properties worth pinning, because getting any
// of them wrong is silent: the number still renders, it is just wrong.
//
//   1. An AI review does not move the percent.
//   2. An AI review does not move the COUNT either. The count is the only thing stopping
//      the table from ranking a submission one reviewer liked above one three reviewers
//      agreed on (scoring.ts), so inflating it with a machine opinion defeats the column
//      that exists to prevent exactly that.
//   3. The default is exclusion, and a caller that has not said which reviewer is the AI
//      excludes nothing rather than guessing.
//
// The filter had no test when it shipped. This is that test.

import { describe, expect, it } from 'vitest'

import { humanReviews, ratingFor, ratingsBySubmission } from '@/features/review/ratings'
import type { Criterion, Review } from '@/types/domain'

const CRITERIA: readonly Criterion[] = [
  { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 1 },
]

const AI_ID = 'recAiReviewer'

function review(reviewerId: string, score: number, id = `rev-${reviewerId}-${score}`): Review {
  return {
    id,
    submissionId: 'recSub1',
    roundId: 'recRnd1',
    reviewerId,
    scores: { relevance: score },
    notes: {},
    recused: false,
    recommendation: 'yes',
    updatedAt: '2026-08-09T00:00:00.000Z',
  }
}

const HUMAN = review('recHuman1', 5)
const AI = review(AI_ID, 1)

describe('humanReviews', () => {
  it('drops the AI reviewer by default', () => {
    expect(humanReviews([HUMAN, AI], { aiReviewerIds: new Set([AI_ID]) })).toEqual([HUMAN])
  })

  it('keeps it when the caller asked to include it', () => {
    const kept = humanReviews([HUMAN, AI], { aiReviewerIds: new Set([AI_ID]), includeAi: true })
    expect(kept).toHaveLength(2)
  })

  it('excludes nothing when no AI reviewer id is known', () => {
    // The honest answer: a caller that has not said which reviewer is the AI has no AI
    // reviews as far as this module can tell. Guessing by email here would put identity
    // resolution in an arithmetic module.
    expect(humanReviews([HUMAN, AI], undefined)).toHaveLength(2)
    expect(humanReviews([HUMAN, AI], { aiReviewerIds: new Set() })).toHaveLength(2)
  })
})

describe('ratingFor, with an AI review present', () => {
  const input = {
    reviewRequired: true,
    reviews: [HUMAN, AI],
    criteria: CRITERIA,
    aiReviewerIds: new Set([AI_ID]),
  }

  it('scores the humans only, so one machine opinion cannot drag the percent down', () => {
    const cell = ratingFor(input)
    // The human gave 5 of 5. The AI gave 1. Averaging both would read 50%.
    expect(cell).toMatchObject({ kind: 'scored', percent: 100 })
  })

  it('does not count the AI review in reviewCount', () => {
    const cell = ratingFor(input)
    expect(cell).toMatchObject({ reviewCount: 1 })
  })

  it('reads as unscored when the ONLY review is the AI one', () => {
    // Not 20%, and not "scored by one reviewer". Nobody on the committee has looked at
    // this yet, which is the opposite signal, and it is what the column must say.
    expect(ratingFor({ ...input, reviews: [AI] })).toEqual({ kind: 'none' })
  })

  it('counts the AI review once the caller opts in', () => {
    const cell = ratingFor({ ...input, includeAi: true })
    expect(cell).toMatchObject({ kind: 'scored', reviewCount: 2 })
  })
})

describe('ratingsBySubmission', () => {
  it('carries the filter through to every row', () => {
    const cells = ratingsBySubmission({
      submissions: [{ id: 'recSub1', reviewRequired: true }],
      reviews: [HUMAN, AI],
      round: { id: 'recRnd1', criteria: CRITERIA },
      aiReviewerIds: new Set([AI_ID]),
    })
    expect(cells.get('recSub1')).toMatchObject({ percent: 100, reviewCount: 1 })
  })

  it('counts the AI review when the filter is not supplied, which is why callers must', () => {
    // This is the failure mode the Abstracts table shipped with for one commit: the
    // loader called this without ever naming the AI reviewer, so a pre-screened round
    // showed the machine's scores in the organizer's Ratings column.
    const cells = ratingsBySubmission({
      submissions: [{ id: 'recSub1', reviewRequired: true }],
      reviews: [HUMAN, AI],
      round: { id: 'recRnd1', criteria: CRITERIA },
    })
    expect(cells.get('recSub1')).toMatchObject({ reviewCount: 2 })
  })
})
