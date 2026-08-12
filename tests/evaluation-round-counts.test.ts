// What the round tab counts, and what the queue ticks. ABS-08.
//
// The rubric item is "per-reviewer completion counts that match the actual review state in
// real time". The per-reviewer widget was already right; the two numbers around it were not:
//
//   - the plan editor reported `4 assigned / 6 reviewed`, which cannot happen, because it
//     counted the AI pre-screen's rows while the Evaluation page excluded them. That half is
//     fixed in `plan-view.ts`, which now counts the committee and the machine separately.
//   - the round tab moved by two on one saved scorecard and both queue cards ticked at once.
//
// The rule these pin is the one in evaluation-queue.ts: `Reviews` is unique on (submission,
// round, reviewer), so THAT TUPLE is the unit of work, and two assignment rows for one pair
// are one piece of work rather than two.

import { describe, expect, it } from 'vitest'

import { buildQueue, roundSummaries } from '@/features/review/evaluation-queue'
import { humanReviews } from '@/features/review/ratings'
import type { Review, Round, SubmissionWithParticipants } from '@/types/domain'

const ROUND: Round = {
  id: 'round1',
  planId: 'plan1',
  eventId: 'event1',
  name: 'Initial review',
  order: 1,
  criteria: [{ key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 1 }],
  anonymous: false,
  reviewerIds: [],
}

const AI_ID = 'recAi'

function assignment(submissionId: string, reviewerId: string) {
  return { roundId: ROUND.id, submissionId, reviewerId }
}

function review(submissionId: string, reviewerId: string): Review {
  return {
    id: `rev-${submissionId}-${reviewerId}`,
    submissionId,
    roundId: ROUND.id,
    reviewerId,
    scores: { relevance: 4 },
    notes: {},
    recused: false,
    updatedAt: '2026-08-11T00:00:00.000Z',
  }
}

function submission(id: string): SubmissionWithParticipants {
  return {
    id,
    eventId: 'event1',
    submitterId: 'speaker1',
    code: id.toUpperCase(),
    title: `Talk ${id}`,
    status: 'pending',
    source: 'form',
    reviewRequired: true,
    answers: {},
    tagIds: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    calendarSequence: 0,
    calendarStatus: 'active',
    participants: [],
  }
}

const ASSIGNMENTS = [
  assignment('sub1', 'human1'),
  assignment('sub2', 'human1'),
  assignment('sub1', 'human2'),
  assignment('sub2', 'human2'),
]

describe('round progress', () => {
  it('counts one review as one, not as one per assignment row', () => {
    const [summary] = roundSummaries([ROUND], ASSIGNMENTS, [review('sub1', 'human1')])
    expect(summary).toMatchObject({ assigned: 4, reviewed: 1 })
  })

  it('does not double count a duplicated assignment row', () => {
    // Two rows for the same (submission, reviewer) can only ever produce ONE review, so
    // counted as rows the round could never reach 100% and one save would move it by two.
    const duplicated = [...ASSIGNMENTS, assignment('sub1', 'human1')]
    const [summary] = roundSummaries([ROUND], duplicated, [review('sub1', 'human1')])
    expect(summary).toMatchObject({ assigned: 4, reviewed: 1 })
  })

  it('reaches its own total when everybody has filed', () => {
    const filed = ASSIGNMENTS.map((row) => review(row.submissionId, row.reviewerId))
    const [summary] = roundSummaries([ROUND], ASSIGNMENTS, filed)
    expect(summary).toMatchObject({ assigned: 4, reviewed: 4 })
  })

  it('leaves the AI pre-screen out, which is what the caller filters for', () => {
    // The pre-screen writes a review per submission and no assignment, so counted in it
    // would report progress the committee has not made. `loadEvaluationView` applies
    // `humanReviews` before calling this; the plan editor now excludes them too.
    const withAi = [review('sub1', AI_ID), review('sub2', AI_ID), review('sub1', 'human1')]
    const [summary] = roundSummaries(
      [ROUND],
      ASSIGNMENTS,
      humanReviews(withAi, { aiReviewerIds: new Set([AI_ID]) }),
    )
    expect(summary).toMatchObject({ assigned: 4, reviewed: 1 })
  })
})

describe('the reviewer queue', () => {
  const submissionById = new Map([
    ['sub1', submission('sub1')],
    ['sub2', submission('sub2')],
  ])

  function queueFor(assignments: readonly ReturnType<typeof assignment>[], reviews: Review[]) {
    return buildQueue({
      assignments,
      reviewerId: 'human1',
      round: ROUND,
      submissionById,
      reviewByKey: new Map(
        reviews.map((entry) => [
          `${entry.submissionId}:${entry.roundId}:${entry.reviewerId}`,
          entry,
        ]),
      ),
      trackNameById: new Map(),
      descriptionFields: new Map(),
    })
  }

  it('ticks only the submission that was reviewed', () => {
    const queue = queueFor(ASSIGNMENTS, [review('sub1', 'human1')])
    expect(queue.map((item) => [item.submissionId, item.reviewed])).toEqual([
      ['sub2', false],
      ['sub1', true],
    ])
  })

  it('shows one card per submission even if the assignment was written twice', () => {
    const queue = queueFor([...ASSIGNMENTS, assignment('sub1', 'human1')], [])
    expect(queue.filter((item) => item.submissionId === 'sub1')).toHaveLength(1)
  })

  it('does not tick a card because a different reviewer filed on the same submission', () => {
    const queue = queueFor(ASSIGNMENTS, [review('sub1', 'human2')])
    expect(queue.every((item) => !item.reviewed)).toBe(true)
  })
})
