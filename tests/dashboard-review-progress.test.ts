// The Review progress card's arithmetic, ref 37.
//
// The cases that matter are all shapes a real base is in on day one: no plan at all, a plan
// with no rounds yet, assignments made and nothing reviewed, and everything reviewed. "Not
// started" and "all done" both put 0 in the "Reviews not started" tile, so the card has to
// be able to tell them apart from something else, which is what `assigned` is for.

import { describe, expect, it } from 'vitest'
import { reviewProgress } from '@/features/dashboard/review-progress'

const PLAN = { id: 'recPlan1', name: '2026 Program Review', status: 'active' } as const
/** What `getActivePlan` falls back to when no plan is active: a real plan, not a current one. */
const CLOSED_PLAN = { id: 'recPlanOld', name: '2025 Program Review', status: 'closed' } as const
const ROUNDS = [{ id: 'recRound1' }, { id: 'recRound2' }]
const REVIEWERS = [
  { id: 'recUser1', name: 'Ada Byron', email: 'ada@example.com' },
  { id: 'recUser2', name: 'Chen Wu', email: 'chen@example.com' },
]

const assign = (submissionId: string, reviewerId: string, roundId = 'recRound1') => ({
  submissionId,
  reviewerId,
  roundId,
})

describe('reviewProgress', () => {
  it('reports an empty card when the event has no active plan', () => {
    const view = reviewProgress({
      plan: undefined,
      rounds: [],
      assignments: [],
      reviews: [],
      reviewers: REVIEWERS,
    })

    expect(view).toEqual({
      plans: 0,
      evaluatedSubmissions: 0,
      reviewsInProgress: 0,
      assigned: 0,
      mostActivePlanName: undefined,
      reviewers: [],
    })
  })

  it('counts no assignments for a plan that has no rounds yet', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: [],
      // Rows from an older plan's rounds. An empty round list must scope these OUT, not
      // fall through to "no filter" and count another plan's work as this one's.
      assignments: [assign('recSub1', 'recUser1', 'recRoundOld')],
      reviews: [assign('recSub1', 'recUser1', 'recRoundOld')],
      reviewers: REVIEWERS,
    })

    expect(view.plans).toBe(1)
    expect(view.assigned).toBe(0)
    expect(view.evaluatedSubmissions).toBe(0)
    expect(view.reviewsInProgress).toBe(0)
    expect(view.reviewers).toEqual([])
  })

  it('distinguishes not started from all done', () => {
    const assignments = [assign('recSub1', 'recUser1'), assign('recSub1', 'recUser2')]
    const notStarted = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments,
      reviews: [],
      reviewers: REVIEWERS,
    })
    const allDone = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments,
      reviews: assignments,
      reviewers: REVIEWERS,
    })

    expect(notStarted.reviewsInProgress).toBe(2)
    expect(notStarted.evaluatedSubmissions).toBe(0)
    expect(allDone.reviewsInProgress).toBe(0)
    expect(allDone.evaluatedSubmissions).toBe(1)
    // Both put 0 in a tile. `assigned` is what tells the card which zero it is looking at.
    expect(notStarted.assigned).toBe(2)
    expect(allDone.assigned).toBe(2)
  })

  it('counts a submission once however many reviewers scored it', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recUser1'), assign('recSub1', 'recUser2')],
      reviews: [assign('recSub1', 'recUser1'), assign('recSub1', 'recUser2')],
      reviewers: REVIEWERS,
    })

    expect(view.evaluatedSubmissions).toBe(1)
  })

  it('matches a review to its assignment on submission, round and reviewer together', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recUser1', 'recRound1')],
      // Same submission and reviewer, a different round: this is not that assignment's
      // review, so the assignment is still in progress.
      reviews: [assign('recSub1', 'recUser1', 'recRound2')],
      reviewers: REVIEWERS,
    })

    expect(view.reviewsInProgress).toBe(1)
    expect(view.evaluatedSubmissions).toBe(1)
  })

  it('gives each reviewer their own reviewed-of-assigned, outstanding work first', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [
        assign('recSub1', 'recUser1'),
        assign('recSub2', 'recUser1'),
        assign('recSub1', 'recUser2'),
        assign('recSub2', 'recUser2'),
      ],
      reviews: [assign('recSub1', 'recUser1'), assign('recSub2', 'recUser1')],
      reviewers: REVIEWERS,
    })

    expect(view.reviewers).toEqual([
      { id: 'recUser2', name: 'Chen Wu', assigned: 2, reviewed: 0 },
      { id: 'recUser1', name: 'Ada Byron', assigned: 2, reviewed: 2 },
    ])
  })

  it('leaves a committee member with nothing assigned off the list', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recUser1')],
      reviews: [],
      reviewers: REVIEWERS,
    })

    expect(view.reviewers.map((row) => row.id)).toEqual(['recUser1'])
  })

  it('still counts an assignment whose reviewer no longer has a membership', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recGone')],
      reviews: [],
      reviewers: REVIEWERS,
    })

    // No row, because there is no name to draw, but the tiles must not lose the work: an
    // assignment nobody is named for is still an unreviewed submission.
    expect(view.reviewers).toEqual([])
    expect(view.assigned).toBe(1)
    expect(view.reviewsInProgress).toBe(1)
  })

  it('labels a reviewer who has never signed in, rather than drawing a blank row', () => {
    // `AdminUsers.name` is blank until somebody signs in, so a member added by email and
    // handed work rendered as an empty span over a progress bar. `reviewerDisplayName` owns
    // the fallback chain and the three evaluation surfaces already use it; this asserts the
    // dashboard is on the same rule rather than on a second copy of it.
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recNew'), assign('recSub2', 'recGhost')],
      reviews: [],
      reviewers: [
        { id: 'recNew', name: '  ', email: 'newcomer@example.com' },
        // No name and no email is only reachable with a deleted AdminUsers row, which the
        // reviewer reads drop. It is covered so the label is total, not because it is expected.
        { id: 'recGhost', name: '', email: '' },
      ],
    })

    expect(view.reviewers.map((row) => row.name)).toEqual(['newcomer@example.com', 'No name yet'])
  })

  it('names the active plan as the most active one', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [],
      reviews: [],
      reviewers: [],
    })

    expect(view.mostActivePlanName).toBe('2026 Program Review')
    expect(view.plans).toBe(1)
  })
})

describe('a plan that is not actually active, found by Codex review', () => {
  it('withholds the most-active-plan line rather than naming a closed plan', () => {
    // `getActivePlan` deliberately falls back to the FIRST plan when none is active, so an
    // event whose only plan is closed still gets a usable Evaluation surface. That fallback is
    // right there and wrong here: naming a closed plan as the most active one states something
    // untrue on the first screen an organizer sees.
    const view = reviewProgress({
      plan: CLOSED_PLAN,
      rounds: ROUNDS,
      assignments: [assign('recSub1', 'recUser1', 'recRound1')],
      reviews: [],
      reviewers: REVIEWERS,
    })

    expect(view.mostActivePlanName).toBeUndefined()
    // The counts stay, because they are real: there IS a plan and there ARE assignments in it.
    // Only the claim about which plan is current is withheld.
    expect(view.plans).toBe(1)
    expect(view.assigned).toBe(1)
  })

  it('still names a genuinely active plan', () => {
    const view = reviewProgress({
      plan: PLAN,
      rounds: ROUNDS,
      assignments: [],
      reviews: [],
      reviewers: REVIEWERS,
    })

    expect(view.mostActivePlanName).toBe('2026 Program Review')
  })
})
