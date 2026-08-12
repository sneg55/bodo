'use server'

// The organizer's bulk deliverables nudge, from the File Requests Delivery status table.
// CNT-08.
//
// It recomputes WHO is behind from the event's own requests and assignments rather than
// trusting the ids the button sent, which is `remindOutstandingTasksAction`'s rule and the
// composer's: a Server Action is reachable by POST with no page ever rendering, so a posted
// recipient list is a way to mail arbitrary addresses on the event's behalf. Recomputing means
// the worst a forged call can do is send the reminder the organizer could have sent.
//
// It also means the message cannot go stale. Between the page render and the press, a speaker
// may have uploaded the last document they owed; because the outstanding set is rebuilt here,
// they drop out of the send instead of being chased for a file that has arrived, which is the
// single most damaging thing a reminder can get wrong.
//
// Queued, not sent: the row goes into EmailOutbox with an idempotency key and the drain sends
// it, which is the one mailing path in this product. The key is per speaker per day, so
// pressing twice in a morning queues nothing the second time and the result says how many were
// skipped.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { fileReminderRows } from '@/features/comms/file-reminder'
import { loadDeliverables } from '@/features/files/deliverables-read'
import {
  outstandingDeliverableRows,
  selectedOutstandingFiles,
} from '@/features/files/outstanding-deliverables'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { getEvent } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type FileReminderResult = {
  readonly queued: number
  /** Reminded already today by an earlier press. */
  readonly skipped: number
  /** How many people the send actually addressed, after recomputing who is behind. */
  readonly speakers: number
  /** The total outstanding documents those messages named, for the confirmation line. */
  readonly files: number
}

/**
 * Remind the accepted speakers who still owe a requested document.
 *
 * `speakerIds` is a FILTER over the people who are genuinely behind, never the recipient list.
 * An empty array means everyone who is behind, which is what the button on the Delivery status
 * header sends: that surface has just shown the organizer exactly who those people are.
 *
 * Both reads are ones the page already makes, with the same tags, so this action subscribes to
 * nothing new.
 */
export async function remindOutstandingFilesAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
}): Promise<ActionResult<FileReminderResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [event, rows] = await Promise.all([
      getEvent(input.eventId),
      loadDeliverables(input.eventId),
    ])

    const behind = outstandingDeliverableRows(rows)
    const recipients = selectedOutstandingFiles(behind, input.speakerIds)

    if (recipients.length === 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'Nobody in that selection has files outstanding.',
        { eventId: input.eventId, picked: input.speakerIds.length },
      )
    }

    const { queued, skipped } = await enqueueEmails(
      fileReminderRows({
        eventId: input.eventId,
        eventName: event.name,
        recipients,
        // The portal, not the event home: a reminder whose link lands somewhere the recipient
        // then has to navigate out of is a reminder that gets postponed.
        portalUrl: `${appUrl()}/portal`,
        now: new Date().toISOString(),
      }),
      'action',
    )

    return actionOk({
      queued,
      skipped,
      speakers: recipients.length,
      files: recipients.reduce((total, row) => total + row.deliverables.length, 0),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
