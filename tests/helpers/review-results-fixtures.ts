// The round, the rubric and the reviews the review results tests are written against.
//
// Shared between review-results.test.ts (what a row says) and
// review-results-columns.test.ts (what the header row says), so the two cannot drift into
// describing different rounds. Same reason `prescreen-fixtures.ts` exists.
//
// The rubric deliberately contains a criterion labelled `Recommendation`, because the
// seeded Initial Review round does and it is what collided with the fixed column of the
// same name in the downloaded file.

import type { ReviewResultsInput } from '@/features/review/review-results'
import type { Criterion, Review } from '@/types/domain'

export const ORIGINALITY: Criterion = {
  key: 'originality',
  label: 'Originality',
  kind: 'numeric',
  min: 1,
  max: 5,
  weight: 1,
}

export const RECOMMENDATION: Criterion = {
  key: 'rec',
  label: 'Recommendation',
  kind: 'select',
  min: 1,
  max: 3,
  weight: 1,
  options: [
    { label: 'Accept', value: 1 },
    { label: 'Maybe', value: 2 },
    { label: 'Reject', value: 3 },
  ],
}

export const COMMENTS: Criterion = {
  key: 'comments',
  label: 'Comments',
  kind: 'text',
  min: 0,
  max: 0,
  weight: 0,
}

export const CRITERIA = [ORIGINALITY, RECOMMENDATION, COMMENTS]

export function review(over: Partial<Review> & Pick<Review, 'id' | 'reviewerId'>): Review {
  return {
    submissionId: 'sub1',
    roundId: 'round1',
    scores: {},
    notes: {},
    recused: false,
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...over,
  }
}

export function input(over: Partial<ReviewResultsInput> = {}): ReviewResultsInput {
  return {
    submissions: [
      {
        id: 'sub1',
        code: 'ABS-1',
        title: 'Edge caching',
        status: 'submitted',
        reviewRequired: true,
      },
    ],
    reviews: [],
    assignments: [],
    reviewerNames: new Map([
      ['user1', 'Ana Ruiz'],
      ['user2', 'Bo Chen'],
    ]),
    round: { criteria: CRITERIA },
    ...over,
  }
}
