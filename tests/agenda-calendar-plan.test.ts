// The calendar planner: whether a schedule write invites, cancels, or does nothing.
//
// Every case here is one a mailbox reports badly. A missed invite looks like a quiet
// queue, a duplicate SEQUENCE looks like a client that ignored the update, and a missing
// cancel looks like nothing at all until a speaker turns up to a session that moved.

import { describe, expect, it } from 'vitest'

import { type CalendarSlot, planCalendarChange } from '@/features/agenda/calendar-plan'

const TRAY: CalendarSlot = { scheduleStatus: 'unscheduled' }
const SLOT: CalendarSlot = {
  scheduleStatus: 'scheduled',
  roomId: 'recRoom1',
  startsAt: '2026-10-12T17:00:00.000Z',
  endsAt: '2026-10-12T17:30:00.000Z',
}
const NEVER_INVITED = { calendarSequence: 0, calendarStatus: 'active' } as const
const INVITED = {
  calendarUid: 'uid-1@bodo',
  calendarSequence: 0,
  calendarStatus: 'active',
} as const

function mint(): string {
  return 'minted-uid@bodo'
}

describe('the first invite', () => {
  it('issues one when a session is scheduled for the first time', () => {
    const plan = planCalendarChange({
      identity: NEVER_INVITED,
      before: TRAY,
      after: SLOT,
      mintUid: mint,
    })

    expect(plan).toEqual({
      action: 'invite',
      uid: 'minted-uid@bodo',
      // SEQUENCE 0, not 1. A client reads same-UID-same-SEQUENCE as a duplicate, so
      // starting at 1 makes the SECOND invite the one that silently does nothing.
      sequence: 0,
      status: 'active',
    })
  })

  it('mints the uid rather than deriving it, and only when one is needed', () => {
    let mints = 0
    const counted = (): string => {
      mints += 1
      return 'once@bodo'
    }

    planCalendarChange({ identity: INVITED, before: TRAY, after: SLOT, mintUid: counted })
    expect(mints).toBe(0)

    planCalendarChange({ identity: NEVER_INVITED, before: TRAY, after: SLOT, mintUid: counted })
    expect(mints).toBe(1)
  })

  it('does not invite a session that is still in the tray', () => {
    const plan = planCalendarChange({
      identity: NEVER_INVITED,
      before: TRAY,
      after: TRAY,
      mintUid: mint,
    })

    expect(plan.action).toBe('none')
  })

  it('does not invite a session with a room but no times', () => {
    const plan = planCalendarChange({
      identity: NEVER_INVITED,
      before: TRAY,
      after: { scheduleStatus: 'scheduled', roomId: 'recRoom1' },
      mintUid: mint,
    })

    expect(plan.action).toBe('none')
  })
})

describe('a reschedule', () => {
  it('keeps the uid and bumps the sequence, which is what updates the entry', () => {
    const plan = planCalendarChange({
      identity: { ...INVITED, calendarSequence: 3 },
      before: SLOT,
      after: { ...SLOT, startsAt: '2026-10-12T18:00:00.000Z' },
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'invite', uid: 'uid-1@bodo', sequence: 4, status: 'active' })
  })

  it('counts a room move as a reschedule', () => {
    const plan = planCalendarChange({
      identity: INVITED,
      before: SLOT,
      after: { ...SLOT, roomId: 'recRoom2' },
      mintUid: mint,
    })

    expect(plan.action).toBe('invite')
  })

  it('counts an end-time change as a reschedule', () => {
    const plan = planCalendarChange({
      identity: INVITED,
      before: SLOT,
      after: { ...SLOT, endsAt: '2026-10-12T18:00:00.000Z' },
      mintUid: mint,
    })

    expect(plan.action).toBe('invite')
  })
})

describe('publishing', () => {
  it('sends nothing, because invites follow the schedule and not the publication', () => {
    // BUILD_SPEC 5.4, in as many words. A speaker whose time did not move must not get a
    // second copy of the same invite because an organizer pressed Publish.
    const plan = planCalendarChange({
      identity: INVITED,
      before: SLOT,
      after: { ...SLOT, scheduleStatus: 'published' },
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'none', reason: 'the slot did not change' })
  })

  it('sends nothing on unpublish either, since the session keeps its slot', () => {
    const plan = planCalendarChange({
      identity: INVITED,
      before: { ...SLOT, scheduleStatus: 'published' },
      after: SLOT,
      mintUid: mint,
    })

    expect(plan.action).toBe('none')
  })
})

describe('unscheduling', () => {
  it('cancels an invited session, so it comes off the calendar', () => {
    const plan = planCalendarChange({
      identity: { ...INVITED, calendarSequence: 2 },
      before: SLOT,
      after: TRAY,
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'cancel', uid: 'uid-1@bodo', sequence: 3, status: 'cancelled' })
  })

  it('does nothing for a session whose invites never went out', () => {
    const plan = planCalendarChange({
      identity: NEVER_INVITED,
      before: SLOT,
      after: TRAY,
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'none', reason: 'never invited, so nothing to cancel' })
  })

  it('does not cancel twice', () => {
    const plan = planCalendarChange({
      identity: { ...INVITED, calendarStatus: 'cancelled' },
      before: TRAY,
      after: TRAY,
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'none', reason: 'already cancelled' })
  })
})

describe('rescheduling a cancelled session', () => {
  it('re-invites on the same uid even when the slot is unchanged', () => {
    // The last thing the speaker's client saw was a CANCEL, so the entry is gone. Only a
    // fresh REQUEST puts it back, and comparing slots would decide nothing had happened.
    const plan = planCalendarChange({
      identity: { ...INVITED, calendarSequence: 5, calendarStatus: 'cancelled' },
      before: SLOT,
      after: SLOT,
      mintUid: mint,
    })

    expect(plan).toEqual({ action: 'invite', uid: 'uid-1@bodo', sequence: 6, status: 'active' })
  })
})
