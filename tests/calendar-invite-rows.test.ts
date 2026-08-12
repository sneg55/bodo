// The producer for calendar invites, and the attachment it produces at send time.
//
// Both halves are here because the bug that motivated the second half was invisible in
// the first: the rows enqueued correctly, and then every cancellation died at the drain.

import { beforeAll, describe, expect, it } from 'vitest'

import { calendarInviteRows } from '@/features/agenda/calendar-invites'
import { inviteAttachments } from '@/features/jobs/invite-attachment'
import type { OutboxRow, SubmissionWithParticipants } from '@/types/domain'

function speaker(id: string, email: string, firstName = 'Ada') {
  return {
    id,
    email,
    firstName,
    lastName: 'Lovelace',
    status: 'confirmed' as const,
  }
}

const SUBMISSION = {
  id: 'recSub1',
  eventId: 'recEvt1',
  code: 'SESS-32',
  title: 'Agents that actually ship',
  status: 'accepted',
  scheduleStatus: 'published',
  startsAt: '2026-10-12T17:30:00.000Z',
  endsAt: '2026-10-12T18:15:00.000Z',
  roomId: 'recRoom1',
  calendarUid: 'uid-1@bodo.example.com',
  calendarSequence: 1,
  calendarStatus: 'active',
  participants: [
    {
      speakerId: 'recSpk1',
      role: 'speaker',
      isPrimary: true,
      sortOrder: 1,
      speaker: speaker('recSpk1', 'ada@example.com'),
    },
    {
      speakerId: 'recSpk2',
      role: 'speaker',
      isPrimary: false,
      sortOrder: 2,
      speaker: speaker('recSpk2', 'grace@example.com', 'Grace'),
    },
  ],
} as unknown as SubmissionWithParticipants

const BASE_INPUT = {
  eventId: 'recEvt1',
  eventName: 'AI Engineer Sandbox',
  eventSlug: 'ai-engineer-sandbox',
  submission: SUBMISSION,
  portalUrl: 'https://bodo.example.com/portal',
  sendAt: '2026-08-10T17:00:00.000Z',
}

describe('calendarInviteRows', () => {
  it('writes one row per participant, so a co-speaker is not left off the calendar', () => {
    const rows = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'invite', uid: 'uid-1@bodo.example.com', sequence: 2, status: 'active' },
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.toEmail)).toEqual(['ada@example.com', 'grace@example.com'])
  })

  it('ends each key in the recipient, since the enqueue upserts on the key', () => {
    // A submission-scoped key would collapse a two-speaker session into one row and tell
    // only one of them. BUILD_SPEC 5.3 says an earlier draft of the table got this wrong.
    const rows = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'invite', uid: 'uid-1@bodo.example.com', sequence: 2, status: 'active' },
    })

    expect(rows.map((row) => row.idempotencyKey)).toEqual([
      'invite:recSub1:2:recSpk1',
      'invite:recSub1:2:recSpk2',
    ])
  })

  it('keys a cancellation separately from an invite at the same sequence', () => {
    const rows = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'cancel', uid: 'uid-1@bodo.example.com', sequence: 2, status: 'cancelled' },
      cancelledSlot: { startsAt: SUBMISSION.startsAt ?? '', endsAt: SUBMISSION.endsAt ?? '' },
    })

    expect(rows.at(0)?.idempotencyKey).toBe('cancel:recSub1:2:recSpk1')
  })

  it('is the one producer that asks for an attachment', () => {
    const rows = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'invite', uid: 'uid-1@bodo.example.com', sequence: 0, status: 'active' },
    })

    expect(rows.every((row) => row.payload.attachIcs)).toBe(true)
  })

  it('carries the cancelled slot only on a cancellation', () => {
    const slot = { startsAt: '2026-10-12T17:30:00.000Z', endsAt: '2026-10-12T18:15:00.000Z' }

    const invite = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'invite', uid: 'uid-1@bodo.example.com', sequence: 0, status: 'active' },
      cancelledSlot: slot,
    })
    const cancel = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'cancel', uid: 'uid-1@bodo.example.com', sequence: 1, status: 'cancelled' },
      cancelledSlot: slot,
    })

    expect(invite.at(0)?.payload.cancelledSlot).toBeUndefined()
    expect(cancel.at(0)?.payload.cancelledSlot).toEqual(slot)
  })

  it('names a cancellation for what it is rather than reusing the acceptance subject', () => {
    const rows = calendarInviteRows({
      ...BASE_INPUT,
      plan: { action: 'cancel', uid: 'uid-1@bodo.example.com', sequence: 1, status: 'cancelled' },
      cancelledSlot: { startsAt: '2026-10-12T17:30:00.000Z', endsAt: '2026-10-12T18:15:00.000Z' },
    })

    expect(rows.at(0)?.payload.subject).toBe('Cancelled: Agents that actually ship')
  })
})

function rowFor(payload: Record<string, unknown>): OutboxRow {
  return {
    id: 'recRow1',
    eventId: 'recEvt1',
    templateSource: 'system',
    submissionId: 'recSub1',
    idempotencyKey: 'cancel:recSub1:2:recSpk1',
    toEmail: 'ada@example.com',
    sendAt: '2026-08-10T17:00:00.000Z',
    status: 'queued',
    attempts: 0,
    payload: { subject: 's', html: '<p>h</p>', attachIcs: true, ...payload },
  } as unknown as OutboxRow
}

describe('the cancellation attachment', () => {
  // The ORGANIZER line comes from EMAIL_FROM, and an invite with no organizer is refused
  // rather than sent without one. The env boundary caches, so this has to land first.
  beforeAll(() => {
    process.env.EMAIL_FROM = 'bodo CFP <cfp@bodo.example.com>'
  })

  const deps = {
    eventId: 'recEvt1',
    loadRoomName: () => Promise.resolve('Main Stage'),
  }

  it('builds from the snapshot when the record has been cleared', async () => {
    // The live failure this test exists for: unscheduling clears `startsAt` and `endsAt`
    // in the same write that enqueues the cancel, so reading them off the record raised
    // MAIL_ICS_INVALID and the row went `dead` on its first attempt. The sweep reported
    // {"claimed":1,"sent":0,"dead":1} and the session stayed on the speaker's calendar.
    const cleared = {
      ...SUBMISSION,
      startsAt: undefined,
      endsAt: undefined,
      roomId: undefined,
      calendarSequence: 2,
      calendarStatus: 'cancelled',
    } as unknown as SubmissionWithParticipants

    const attachments = await inviteAttachments(
      rowFor({
        cancelledSlot: {
          startsAt: '2026-10-12T17:30:00.000Z',
          endsAt: '2026-10-12T18:15:00.000Z',
          room: 'Main Stage',
        },
      }),
      { ...deps, loadSubmission: () => Promise.resolve(cleared) },
    )

    const content = attachments?.at(0)?.content ?? ''
    expect(content).toContain('METHOD:CANCEL')
    expect(content).toContain('SEQUENCE:2')
    // Same UID as the invite it withdraws, or the client has nothing to remove.
    expect(content).toContain('UID:uid-1@bodo.example.com')
    expect(content).toContain('DTSTART:20261012T173000Z')
    expect(attachments?.at(0)?.contentType).toBe('text/calendar; method=CANCEL')
  })

  it('still reads the record for an ordinary invite, so the times are the current ones', async () => {
    const attachments = await inviteAttachments(rowFor({}), {
      ...deps,
      loadSubmission: () => Promise.resolve(SUBMISSION),
    })

    const content = attachments?.at(0)?.content ?? ''
    expect(content).toContain('METHOD:REQUEST')
    expect(content).toContain('DTSTART:20261012T173000Z')
    expect(content).toContain('LOCATION:Main Stage')
  })
})
