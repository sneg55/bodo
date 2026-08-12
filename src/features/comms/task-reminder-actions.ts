'use server'

// The organizer's bulk deliverables nudge, from the Tasks page. CNT-08.
//
// It recomputes WHO is behind from the event's own tasks and assignments rather than trusting
// the ids the button sent, which is `remindReviewersAction`'s rule and is the same rule the
// composer follows: a Server Action is reachable by POST with no page ever rendering, so a
// posted recipient list is a way to mail arbitrary addresses on the event's behalf. Recomputing
// means the worst a forged call can do is send the reminder the organizer could have sent.
//
// It also means the message cannot go stale. Between the page render and the press, a speaker
// may have finished the last thing they owed; because the outstanding set is rebuilt here, they
// drop out of the send instead of being chased for work they have done, which is the single
// most damaging thing a reminder can get wrong.
//
// Queued, not sent. The key is per speaker per day, so pressing twice in a morning queues
// nothing the second time and the result says how many were skipped.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { outstandingTaskRows, selectedOutstanding } from '@/features/comms/outstanding-tasks'
import { taskReminderRows } from '@/features/comms/task-reminder'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { getEvent, listSubmissions, listTaskAssignmentsForEvent } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type TaskReminderResult = {
  readonly queued: number
  /** Reminded already today by an earlier press. */
  readonly skipped: number
  /** How many people the send actually addressed, after recomputing who is behind. */
  readonly speakers: number
  /** The total outstanding to-dos those messages named, for the confirmation line. */
  readonly tasks: number
}

/**
 * Remind the accepted speakers who still owe deliverables.
 *
 * `speakerIds` is a FILTER over the people who are genuinely behind, never the recipient
 * list. An empty array means everyone who is behind, which is what the button on the
 * Onboarding status header sends: that surface has just shown the organizer exactly who
 * those people are.
 *
 * The three reads are ones `loadTasksAdminView` already makes, so this action subscribes to
 * nothing the Tasks page was not reading anyway. `listSpeakers` is deliberately not among them
 * for the reason that view gives: the accepted roster is already resolved on the submissions
 * read. `listTasksForEvent` is not needed either, because `listTaskAssignmentsForEvent`
 * returns assignments already joined to their tasks.
 */
export async function remindOutstandingTasksAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
}): Promise<ActionResult<TaskReminderResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [event, items, submissions] = await Promise.all([
      getEvent(input.eventId),
      listTaskAssignmentsForEvent(input.eventId),
      listSubmissions(input.eventId),
    ])

    const behind = outstandingTaskRows({
      scopes: acceptedSpeakerScopes(submissions),
      items,
      timeZone: event.timezone,
    })
    const recipients = selectedOutstanding(behind, input.speakerIds)

    if (recipients.length === 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'Nobody in that selection has tasks outstanding.',
        { eventId: input.eventId, picked: input.speakerIds.length },
      )
    }

    const { queued, skipped } = await enqueueEmails(
      taskReminderRows({
        eventId: input.eventId,
        eventName: event.name,
        recipients,
        // The portal, not the event home: a reminder whose link lands somewhere the
        // recipient then has to navigate out of is a reminder that gets postponed.
        portalUrl: `${appUrl()}/portal`,
        now: new Date().toISOString(),
      }),
      'action',
    )

    return actionOk({
      queued,
      skipped,
      speakers: recipients.length,
      tasks: recipients.reduce((total, row) => total + row.tasks.length, 0),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
