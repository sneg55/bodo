// One place that moves a session, so no caller can move one and forget the calendar.
//
// Every schedule write in the app goes through here: a drag, the auto-schedule button,
// and a placement cleared back to the tray. They used to call `scheduleSubmission`
// directly, which wrote the columns and nothing else, and that is how a feature with a
// finished sender (ics.ts, invite-attachment.ts, both provider adapters) shipped without
// a single caller that ever asked for an invite.
//
// The order is: read, plan, write, enqueue. `calendar-invites.ts` says why the enqueue
// comes last, and `calendar-plan.ts` owns every decision about UID and SEQUENCE.

import { calendarInviteRows } from '@/features/agenda/calendar-invites'
import { type CalendarSlot, planCalendarChange } from '@/features/agenda/calendar-plan'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { roomNameOf } from '@/features/jobs/invite-attachment'
import { enqueueOutbox } from '@/features/submissions/decision-outbox'
import { type ScheduleChange, scheduleSubmission } from '@/services/airtable/mutations'
import { getEvent, getSubmission } from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { SubmissionWithParticipants } from '@/types/domain'
import { appUrl, getEnv } from '@/utils/env'

export type ScheduleWrite = Omit<ScheduleChange, 'calendar'>

/**
 * A calendar UID, minted once per session and stored.
 *
 * A UUID and not a derivation of the record id. §5.3 is explicit: a derived UID looks
 * identical and breaks silently the moment a record is recreated, because the speaker's
 * client then has an entry it can no longer be told about. The domain half is cosmetic and
 * only has to be stable; it comes from `EMAIL_FROM` so an invite and its sender agree.
 */
function mintCalendarUid(): string {
  const from = getEnv().EMAIL_FROM ?? ''
  const at = from.lastIndexOf('@')
  const domain =
    at === -1
      ? 'bodo'
      : from
          .slice(at + 1)
          .replace('>', '')
          .trim()
  return `${crypto.randomUUID()}@${domain === '' ? 'bodo' : domain}`
}

function slotOf(source: {
  scheduleStatus: CalendarSlot['scheduleStatus']
  startsAt?: string
  endsAt?: string
  roomId?: string
}): CalendarSlot {
  return {
    scheduleStatus: source.scheduleStatus,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    roomId: source.roomId,
  }
}

/**
 * Apply a schedule change and tell whoever is on it.
 *
 * `before` is passed in when the caller has already read the row, so a bulk placement is
 * one read per session rather than two. Returns how many invite or cancellation rows were
 * queued, because "placed 12" and "told nobody" are different outcomes and an organizer
 * pressing Auto-schedule deserves to be able to tell them apart.
 */
export async function applySchedule(
  change: ScheduleWrite,
  before?: SubmissionWithParticipants,
): Promise<{ queued: number }> {
  const submission = before ?? (await getSubmission(change.submissionId))

  const plan = planCalendarChange({
    identity: {
      calendarUid: submission.calendarUid,
      calendarSequence: submission.calendarSequence,
      calendarStatus: submission.calendarStatus,
    },
    before: slotOf(submission),
    after: slotOf(change),
    mintUid: mintCalendarUid,
  })

  if (plan.action === 'none') {
    await scheduleSubmission(change)
    return { queued: 0 }
  }

  const sendAt = new Date().toISOString()
  await scheduleSubmission({
    ...change,
    // DTSTAMP is the moment this message was produced, which is now. The row's stored
    // stamp is what `invite-attachment.ts` falls back on, so writing it here keeps the
    // .ics and the record telling the same story.
    calendar: { uid: plan.uid, sequence: plan.sequence, status: plan.status, dtstamp: sendAt },
  })

  const event = await getEvent(change.eventId)
  // Snapshotted BEFORE the write is read back, from the row as it was. A cancellation has
  // to name the entry the speaker's client already holds, and the write above has just
  // cleared the times it would otherwise be read from.
  const cancelledSlot =
    plan.action === 'cancel' && submission.startsAt !== undefined && submission.endsAt !== undefined
      ? {
          startsAt: submission.startsAt,
          endsAt: submission.endsAt,
          ...(submission.roomId === undefined
            ? {}
            : { room: await roomNameOf(change.eventId, submission.roomId) }),
        }
      : undefined

  return {
    queued: await enqueueOutbox(
      calendarInviteRows({
        eventId: change.eventId,
        eventName: event.name,
        eventSlug: event.slug,
        // The row as it will be at send time: the write above has landed, and the invite
        // is built from the record rather than from this snapshot. Only the identity and
        // the cast are read off it here.
        submission,
        plan,
        template: await findEmailTemplate(change.eventId, TEMPLATE_KEYS.accepted),
        portalUrl: `${appUrl()}/portal`,
        sendAt,
        cancelledSlot,
      }),
    ),
  }
}
