'use server'

// The Evaluation surface's writes: a reviewer saving a score, and an admin assigning a
// committee.
//
// Both authorize for themselves, and they do not authorize the same thing:
//
//   - `saveReviewAction` needs `reviewer` on the event AND a `ReviewAssignments` row for
//     the acting user on that (submission, round). BUILD_SPEC 5.4 says the assignment
//     check runs in the server action, not only in the layout, and section 4 says why: a
//     Server Action is reachable without the layout ever rendering. Holding a reviewer
//     role on an event is not permission to score every submission in it.
//   - `assignCommitteeAction` needs `admin`, because deciding who reviews what is an
//     organizer's job. A reviewer calling it gets AUTH_FORBIDDEN_ROLE.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { distributeAssignments } from '@/features/review/distribution'
import {
  type ReviewDraftState,
  sanitizeNotes,
  sanitizeScores,
} from '@/features/review/review-draft'
import {
  listAssignmentsForEvent,
  listEventReviewers,
  listTeamMemberIds,
} from '@/features/review/review-reads'
import {
  assignReviewerPairs,
  assignReviewers,
  enterSubmissionsIntoRound,
  saveReview,
} from '@/services/airtable/mutations-review'
import { listAssignmentsForReviewer, listRoundsForActivePlan } from '@/services/airtable/queries'
import type { RecordId, Round } from '@/types/domain'

async function requireRound(eventId: RecordId, roundId: RecordId): Promise<Round> {
  const round = (await listRoundsForActivePlan(eventId)).find((entry) => entry.id === roundId)
  if (round === undefined) {
    // Not a 404: the rounds of the ACTIVE plan are the only ones the UI offers, so a
    // round id from anywhere else is either stale or forged.
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that round is not in the active plan', {
      eventId,
      roundId,
    })
  }
  return round
}

export async function saveReviewAction(input: {
  eventId: RecordId
  submissionId: RecordId
  roundId: RecordId
  draft: ReviewDraftState
}): Promise<ActionResult<{ savedAt: string }>> {
  try {
    const { userId } = await requireEventRole(input.eventId, 'reviewer')
    const round = await requireRound(input.eventId, input.roundId)

    const assignments = await listAssignmentsForReviewer(input.eventId, userId)
    const assigned = assignments.some(
      (assignment) =>
        assignment.submissionId === input.submissionId && assignment.roundId === input.roundId,
    )
    if (!assigned) {
      // Enforced for an admin too. An organizer who wants to score assigns themselves,
      // which leaves a row saying so; a silent admin bypass would put scores in the
      // average from someone the committee never saw.
      throw new AppError(
        ErrorIds.AUTH_FORBIDDEN_ROLE,
        'you are not assigned to review this submission in this round',
        { userId, submissionId: input.submissionId, roundId: input.roundId },
      )
    }

    const savedAt = new Date().toISOString()
    await saveReview({
      eventId: input.eventId,
      submissionId: input.submissionId,
      roundId: input.roundId,
      reviewerId: userId,
      // Filtered against this round's rubric on the way in, so a criterion deleted
      // after a reviewer scored it stops being written back.
      // A RECUSED review carries no scores, no notes and no recommendation, whatever the
      // form sent. Clearing them here rather than trusting the client is what makes the
      // recusal mean something: a reviewer who scores a submission, then declares a
      // conflict, must not leave those scores sitting in the average, and a stale
      // recommendation would keep voting for them.
      scores: input.draft.recused ? {} : sanitizeScores(input.draft.scores, round.criteria),
      notes: input.draft.recused ? {} : sanitizeNotes(input.draft.notes, round.criteria),
      recused: input.draft.recused,
      comment: input.draft.comment.trim().length === 0 ? undefined : input.draft.comment,
      // `null`, not `undefined`: the column has to be CLEARED. See `ReviewDraft`.
      recommendation: input.draft.recused ? null : input.draft.recommendation,
      updatedAt: savedAt,
    })

    return actionOk({ savedAt })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Committee assignment. Materialises one `ReviewAssignments` row per (submission,
 * reviewer) and enters each submission into the round.
 *
 * Section 3 is explicit that a team assignment expands into individual rows rather than a
 * team-level record the reviewer queue joins through, so "assigned to me" stays one
 * lookup and a reviewer dropped from the committee keeps the work already in flight.
 */
export async function assignCommitteeAction(input: {
  eventId: RecordId
  roundId: RecordId
  submissionIds: readonly RecordId[]
  /** Set when a committee was picked. Absent for the per-submission reviewer picker. */
  teamId?: RecordId
  /** Used when no team was picked. Section 5.4 calls this the escape hatch. */
  reviewerIds?: readonly RecordId[]
}): Promise<ActionResult<{ created: number; skipped: number; entered: number }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const round = await requireRound(input.eventId, input.roundId)

    const picked =
      input.teamId === undefined
        ? (input.reviewerIds ?? [])
        : await listTeamMemberIds(input.eventId, input.teamId)

    // The round's reviewer pool, enforced HERE and not only in the panel that filters
    // its checkbox list. A committee assigned as a team is the case that makes this
    // matter: the team is keyed by event and its membership has no idea a round was
    // restricted, so without this line assigning "Program Committee" to a three-person
    // round would quietly put all six of them in it.
    const reviewerIds =
      round.reviewerIds.length === 0
        ? picked
        : picked.filter((id) => round.reviewerIds.includes(id))

    if (input.submissionIds.length === 0 || reviewerIds.length === 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        picked.length > 0 && reviewerIds.length === 0
          ? 'None of those reviewers are in the pool for this round.'
          : 'Pick at least one submission and one reviewer or committee.',
        { submissions: input.submissionIds.length, reviewers: reviewerIds.length },
      )
    }

    const assignedAt = new Date().toISOString()
    const entry = await enterSubmissionsIntoRound({
      eventId: input.eventId,
      roundId: input.roundId,
      submissionIds: input.submissionIds,
      enteredAt: assignedAt,
    })

    const assignment = await assignReviewers({
      eventId: input.eventId,
      roundId: input.roundId,
      submissionIds: input.submissionIds,
      reviewerIds,
      viaTeamId: input.teamId,
      source: input.teamId === undefined ? 'manual' : 'team',
      assignedAt,
    })

    return actionOk({ ...assignment, entered: entry.created })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Spread the selected submissions across the round's reviewers in one action (ABS-06).
 *
 * The committee path above assigns everybody to everything, which is right for a small
 * programme committee and wrong for forty abstracts and six reviewers. This one balances:
 * least-loaded first, existing assignments counted, and the round's `maxPerReviewer`
 * respected. The arithmetic is `distribution.ts` and is unit tested; what lives here is
 * the authorization, the pool resolution and the two writes.
 *
 * The shortfall is returned rather than thrown. An organizer whose cap is too low for the
 * pile they selected needs the plan AND the number of submissions nobody is reading, and a
 * refusal gives them neither.
 */
export async function distributeAssignmentsAction(input: {
  eventId: RecordId
  roundId: RecordId
  submissionIds: readonly RecordId[]
  reviewersPerSubmission: number
}): Promise<ActionResult<{ created: number; short: number; reviewers: number }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const round = await requireRound(input.eventId, input.roundId)

    // An empty pool means EVERYONE on the event, per `Round.reviewerIds`. Resolving it
    // here rather than passing the empty array through is what keeps `distribution.ts`
    // free of that rule: it is given a pool and balances over it.
    const reviewerIds =
      round.reviewerIds.length > 0
        ? round.reviewerIds
        : (await listEventReviewers(input.eventId)).map((reviewer) => reviewer.id)

    if (input.submissionIds.length === 0 || reviewerIds.length === 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        reviewerIds.length === 0
          ? 'This round has no reviewers to distribute to.'
          : 'Pick at least one submission to distribute.',
        { submissions: input.submissionIds.length, reviewers: reviewerIds.length },
      )
    }

    const assignments = await listAssignmentsForEvent(input.eventId)
    const plan = distributeAssignments({
      submissionIds: input.submissionIds,
      reviewerIds,
      existing: assignments.filter((row) => row.roundId === input.roundId),
      reviewersPerSubmission: input.reviewersPerSubmission,
      maxPerReviewer: round.maxPerReviewer,
    })

    const assignedAt = new Date().toISOString()
    // The round entry comes first for the same reason it does above: a submission with
    // assignments and no `SubmissionRounds` row has nothing for the progress view to count.
    await enterSubmissionsIntoRound({
      eventId: input.eventId,
      roundId: input.roundId,
      submissionIds: input.submissionIds,
      enteredAt: assignedAt,
    })

    const written = await assignReviewerPairs({
      eventId: input.eventId,
      roundId: input.roundId,
      pairs: plan.pairs,
      source: 'manual',
      assignedAt,
    })

    return actionOk({
      created: written.created,
      short: plan.short.length,
      reviewers: reviewerIds.length,
    })
  } catch (error) {
    return actionFailure(error)
  }
}
