'use server'

// The chair's override of an AI pre-screen score, and the withdrawal of one.
//
// ADMIN, not `reviewer`, and checked here rather than only in the layout, for the reason
// actions.ts gives about its own pair: a Server Action is reachable by POST with no page
// ever rendering, so a fellow reviewer must not be able to rewrite what the committee sees
// on a submission. Overriding the machine is a programme chair's call.
//
// It writes through `saveReview`, the same mutation the reviewer's autosave and the
// pre-screen drain both use, so the tags this touches are expired by the one place that
// decides what expiry means (`invalidate`). The row it addresses is the AI's own, keyed on
// (submission, round, `ai@system`), and the AI's scores, rationale and recommendation are
// written back UNCHANGED: only the reserved note in `ai-override.ts` moves. That is what
// keeps both numbers on screen instead of replacing one with the other.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import {
  type AiOverride,
  overridePercent,
  withAiOverride,
  withoutAiOverride,
} from '@/features/review/ai-override'
import { aiReviewerOrNone } from '@/features/review/ai-reviewer'
import { isRecommendation } from '@/features/review/review-draft'
import { listEventReviewers } from '@/features/review/review-reads'
import { reviewerDisplayName } from '@/features/review/reviewer-progress'
import { saveReview } from '@/services/airtable/mutations-review'
import { getSubmission, listRoundsForActivePlan } from '@/services/airtable/queries'
import { findReview } from '@/services/airtable/reads-review'
import type { RecordId, Review } from '@/types/domain'

export type AiOverrideInput = {
  eventId: RecordId
  submissionId: RecordId
  roundId: RecordId
  /** What the organizer typed in the percent box. Clamped to 0-100 by `overridePercent`. */
  percent: string
  /** Their own verdict. Empty leaves the AI's recommendation showing. */
  recommendation?: string
  note?: string
}

/**
 * Everything both actions have to establish before they touch a row: that the caller is a
 * chair on THIS event, that the round is one of this event's, that the submission is too,
 * and that there is an AI review to override in the first place.
 *
 * Returned rather than thrown one by one so the two actions cannot drift apart on which
 * check they make, which is how the second copy of an authorization ends up weaker.
 */
async function resolveAiReview(input: {
  eventId: RecordId
  submissionId: RecordId
  roundId: RecordId
}): Promise<{ review: Review; actorName: string }> {
  const { userId } = await requireEventRole(input.eventId, 'admin')

  const [rounds, submission, aiReviewerId, reviewers] = await Promise.all([
    listRoundsForActivePlan(input.eventId),
    getSubmission(input.submissionId),
    aiReviewerOrNone(),
    listEventReviewers(input.eventId),
  ])

  if (!rounds.some((round) => round.id === input.roundId)) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that round is not in the active plan', {
      eventId: input.eventId,
      roundId: input.roundId,
    })
  }
  // The same check `loadSubmissionDetail` makes and for the same reason: a submission id is
  // a path segment, so holding admin on one event must not reach another event's record.
  if (submission.eventId !== input.eventId) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no such submission on this event', {
      eventId: input.eventId,
      submissionId: input.submissionId,
    })
  }
  if (aiReviewerId === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'the ai@system reviewer has not been seeded on this base, so there is no AI review to override',
      { eventId: input.eventId },
    )
  }

  // Uncached (`findReview`), because this decides what gets written back over the row.
  const review = await findReview({
    submissionId: input.submissionId,
    roundId: input.roundId,
    reviewerId: aiReviewerId,
  })
  if (review === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'this submission has no AI pre-screen review in that round',
      { submissionId: input.submissionId, roundId: input.roundId },
    )
  }

  const actor = reviewers.find((reviewer) => reviewer.id === userId)
  return { review, actorName: actor === undefined ? 'An organizer' : reviewerDisplayName(actor) }
}

/** Write the AI review back with the chair's score recorded beside the machine's. */
export async function setAiOverrideAction(
  input: AiOverrideInput,
): Promise<ActionResult<{ percent: number }>> {
  try {
    const percent = overridePercent(input.percent)
    if (percent === undefined) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'Enter the score you want recorded, as a number between 0 and 100.',
        { percent: input.percent },
      )
    }

    const { review, actorName } = await resolveAiReview(input)
    const note = input.note?.trim() ?? ''
    const override: AiOverride = {
      percent,
      by: actorName,
      at: new Date().toISOString(),
      ...(input.recommendation !== undefined && isRecommendation(input.recommendation)
        ? { recommendation: input.recommendation }
        : {}),
      ...(note === '' ? {} : { note }),
    }

    await saveReview({
      eventId: input.eventId,
      submissionId: review.submissionId,
      roundId: review.roundId,
      reviewerId: review.reviewerId,
      // The machine's own answers, written back byte for byte. An override that edited
      // these would leave the panel unable to say what the AI actually thought, which is
      // half of what the rubric item asks the surface to show.
      scores: review.scores,
      notes: withAiOverride(review.notes, override),
      comment: review.comment,
      recused: review.recused,
      recommendation: review.recommendation,
      // NOT bumped. `updatedAt` says when this review was scored, the override carries its
      // own `at`, and moving it would reorder the review list around an edit to a note.
      updatedAt: review.updatedAt,
    })

    return actionOk({ percent })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Withdraw the override. The row goes back to being the machine's, unedited. */
export async function clearAiOverrideAction(input: {
  eventId: RecordId
  submissionId: RecordId
  roundId: RecordId
}): Promise<ActionResult<{ cleared: true }>> {
  try {
    const { review } = await resolveAiReview(input)

    await saveReview({
      eventId: input.eventId,
      submissionId: review.submissionId,
      roundId: review.roundId,
      reviewerId: review.reviewerId,
      scores: review.scores,
      notes: withoutAiOverride(review.notes),
      comment: review.comment,
      recused: review.recused,
      recommendation: review.recommendation,
      updatedAt: review.updatedAt,
    })

    return actionOk({ cleared: true as const })
  } catch (error) {
    return actionFailure(error)
  }
}
