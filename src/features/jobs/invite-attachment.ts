// The calendar invite an outbox row asks for, built at send time.
//
// Only the identity fields come from the submission record, and that is the judged
// property in BUILD_SPEC 5.3: `calendarUid` is written once and never changes,
// `calendarSequence` increments per send, so a rescheduled session UPDATES the entry in
// the speaker's calendar rather than adding a second one. Deriving a UID here from the
// record id would look identical and quietly break the moment a record is recreated, so
// a row that wants an invite and has no stored UID is a failure rather than a guess.
//
// It runs at send time and not at enqueue time because an .ics is large, it is derivable,
// and `payloadJson` snapshots the message body for a reason that does not apply to it: a
// template edit must not change promised mail, whereas the room and time an invite states
// should be the ones that are true when it is sent.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { buildInvite, mailboxOf } from '@/features/comms/ics'
import { listRooms } from '@/services/airtable/queries'
import type { EmailAttachment } from '@/services/email/send'
import type { OutboxRow, SubmissionWithParticipants } from '@/types/domain'
import { appUrl, getEnv } from '@/utils/env'

export type InviteDeps = {
  eventId: string
  loadSubmission: (submissionId: string) => Promise<SubmissionWithParticipants>
  loadRoomName: (eventId: string, roomId: string) => Promise<string | undefined>
}

function invalid(message: string, context: Record<string, unknown>): AppError {
  // MAIL_ICS_INVALID is one of the three ids the drain treats as permanent, which is what
  // these cases want: a row missing its calendar identity fails the same way on every
  // retry, so burning five attempts on it only delays the mail that could still go out.
  return new AppError(ErrorIds.MAIL_ICS_INVALID, message, context)
}

/**
 * Attachments for one row, or nothing when the row did not ask for an invite.
 *
 * Shaped as `DrainDeps['buildAttachments']` once bound, so the drain stays ignorant of
 * calendars and this stays ignorant of leases.
 */
export async function inviteAttachments(
  row: OutboxRow,
  deps: InviteDeps,
): Promise<readonly EmailAttachment[] | undefined> {
  if (!row.payload.attachIcs) return undefined

  if (row.submissionId === undefined) {
    throw invalid('an outbox row asked for an invite without a submission', { rowId: row.id })
  }

  const submission = await deps.loadSubmission(row.submissionId)
  const { calendarUid } = submission
  // The snapshot wins when the row carries one, and only a cancellation does. Unscheduling
  // clears the times in the same write that enqueues the cancel, so reading them off the
  // record here failed every time: the row raised MAIL_ICS_INVALID, which is permanent, and
  // died on its first attempt while the session stayed on the speaker's calendar. A CANCEL
  // has to name the entry the client already holds, so the last sent slot is also the
  // correct thing to state. See `outboxPayloadSchema`.
  const slot = row.payload.cancelledSlot
  const startsAt = slot?.startsAt ?? submission.startsAt
  const endsAt = slot?.endsAt ?? submission.endsAt

  if (calendarUid === undefined || startsAt === undefined || endsAt === undefined) {
    throw invalid('the submission has no calendar identity or no scheduled time', {
      rowId: row.id,
      submissionId: submission.id,
      hasUid: calendarUid !== undefined,
    })
  }

  const from = getEnv().EMAIL_FROM
  if (from === undefined) {
    throw invalid('EMAIL_FROM is not configured, so an invite would have no ORGANIZER', {
      rowId: row.id,
    })
  }

  const cancelled = submission.calendarStatus === 'cancelled'
  const content = buildInvite({
    calendarUid,
    calendarSequence: submission.calendarSequence,
    // The stamp is the LAST send, so a row being sent now with no stamp yet is stamped
    // with the row's own send time rather than left blank.
    calendarDtstamp: submission.calendarDtstamp ?? row.sendAt,
    startsAt,
    endsAt,
    // `EMAIL_FROM` may legally be `bodo CFP <cfp@example.com>`, which is not a
    // CAL-ADDRESS. Passing it through unchanged makes clients drop the organizer.
    organizerEmail: mailboxOf(from),
    participantEmails: submission.participants.map((participant) => participant.speaker.email),
    title: submission.title,
    room:
      slot === undefined
        ? submission.roomId === undefined
          ? undefined
          : await deps.loadRoomName(deps.eventId, submission.roomId)
        : slot.room,
    portalUrl: `${appUrl()}/portal`,
    calendarStatus: submission.calendarStatus,
  })

  return [
    {
      filename: 'invite.ics',
      // Raw text. The provider adapter base64-encodes it; doing it here would arrive as
      // binary garbage. The `method` parameter is what makes Gmail, Outlook and Apple
      // render this as an invite instead of a file attachment.
      content,
      contentType: `text/calendar; method=${cancelled ? 'CANCEL' : 'REQUEST'}`,
    },
  ]
}

/** Room names come from a lookup list, so one read serves every row in the sweep. */
export async function roomNameOf(eventId: string, roomId: string): Promise<string | undefined> {
  const rooms = await listRooms(eventId)
  return rooms.find((room) => room.id === roomId)?.name
}
