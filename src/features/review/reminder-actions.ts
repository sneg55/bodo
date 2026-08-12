'use server'

// The chair's bulk nudge to reviewers who still owe work in a round.
//
// Admin only, and it recomputes WHO from the round's own assignments rather than trusting
// the list of ids the button sent. A Server Action is reachable by POST with no page ever
// rendering, so a posted recipient list is a way to mail arbitrary addresses on the
// event's behalf; recomputing means the worst a forged call can do is send the reminder
// the chair could have sent anyway.
//
// Queued, not sent. `enqueueEmails` upserts on `idempotencyKey`, and the key is per
// reviewer per round per DAY, so pressing the button twice in a morning queues nothing the
// second time and the result says how many were skipped.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { dateTimeText } from '@/features/review/date-text'
import {
  listAssignmentsForEvent,
  listEventReviewers,
  listReviewsForEvent,
} from '@/features/review/review-reads'
import { reviewerProgress, reviewersBehind } from '@/features/review/reviewer-progress'
import { reviewerReminderRows } from '@/features/review/reviewer-reminder'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { getEvent, listRoundsForActivePlan } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export async function remindReviewersAction(input: {
  eventId: RecordId
  roundId: RecordId
  /**
   * Who the chair ticked. Treated as a FILTER over the people who are genuinely behind,
   * never as the recipient list: an id that is not behind in this round is dropped.
   */
  reviewerIds: readonly RecordId[]
}): Promise<ActionResult<{ queued: number; skipped: number }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const round = (await listRoundsForActivePlan(input.eventId)).find(
      (entry) => entry.id === input.roundId,
    )
    if (round === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that round is not in the active plan', {
        eventId: input.eventId,
        roundId: input.roundId,
      })
    }

    const [event, reviewers, assignments, reviews] = await Promise.all([
      getEvent(input.eventId),
      listEventReviewers(input.eventId),
      listAssignmentsForEvent(input.eventId),
      listReviewsForEvent(input.eventId),
    ])

    const behind = reviewersBehind(
      reviewerProgress({ reviewers, assignments, reviews, roundId: round.id }),
    )
    const picked = new Set(input.reviewerIds)
    const recipients =
      picked.size === 0 ? behind : behind.filter((row) => picked.has(row.reviewerId))

    if (recipients.length === 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'Nobody in that selection has reviews outstanding in this round.',
        { roundId: round.id, picked: picked.size },
      )
    }

    const result = await enqueueEmails(
      reviewerReminderRows({
        eventId: input.eventId,
        eventName: event.name,
        roundId: round.id,
        roundName: round.name,
        recipients,
        closesAt:
          round.endsAt === undefined ? undefined : dateTimeText(round.endsAt, event.timezone),
        // The queue, not the event home: a reminder whose link lands somewhere the
        // recipient then has to navigate out of is a reminder that gets postponed.
        queueUrl: `${appUrl()}/admin/${input.eventId}/evaluation?round=${round.id}`,
        now: new Date().toISOString(),
      }),
      'action',
    )

    return actionOk(result)
  } catch (error) {
    return actionFailure(error)
  }
}
