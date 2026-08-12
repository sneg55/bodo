// The schedule write stores the calendar identity it is handed, in the same update as
// the new times.
//
// The rule this protects is the one that decides whether a follow-up invite UPDATES the
// entry on a speaker's calendar or is ignored as a duplicate. A client compares UID and
// SEQUENCE: same UID with a higher SEQUENCE is an update, same UID and the same SEQUENCE
// is a no-op. So the number that reaches the row is the number the mail will carry, and
// getting it wrong leaves every speaker looking at the old slot with no error anywhere.
//
// WHO decides that number moved. The writer used to compute `sequence + 1` itself and
// derive `calendarStatus` from `scheduleStatus`, which could not express the first invite:
// SEQUENCE starts at 0 (BUILD_SPEC 3) and a writer that always bumps makes the first
// message a 1 and the second one a duplicate of nothing. `planCalendarChange` now decides,
// tested in tests/agenda-calendar-plan.test.ts, and this file checks that the writer
// stores that decision faithfully rather than second-guessing it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Update = { id: string; fields: Record<string, unknown> }

const updateRecords = vi.fn<(table: string, updates: readonly Update[]) => Promise<unknown>>()

vi.mock('@/services/airtable/client', () => ({
  getClient: () => ({ updateRecords }),
}))

// Cache invalidation needs a Next request store, which a unit test has no business
// creating. The tags it emits are covered by tests/airtable-tags.test.ts; what is
// under test here is the field payload.
vi.mock('@/services/airtable/invalidate', () => ({
  invalidate: () => undefined,
}))

const BASE = {
  submissionId: 'recSub1',
  eventId: 'recEvt1',
  roomId: 'recRoom1',
  startsAt: '2026-10-12T17:00:00.000Z',
  endsAt: '2026-10-12T17:30:00.000Z',
  scheduleStatus: 'scheduled',
} as const

const DTSTAMP = '2026-08-10T12:00:00.000Z'

async function schedule(change: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { scheduleSubmission } = await import('@/services/airtable/mutations')
  await scheduleSubmission(change as never, 'route')
  const call = updateRecords.mock.calls.at(0)
  return call?.[1].at(0)?.fields ?? {}
}

beforeEach(() => {
  updateRecords.mockReset()
  updateRecords.mockResolvedValue(undefined)
})

describe('scheduleSubmission calendar identity', () => {
  it('leaves calendar fields alone when the change touches nobody s calendar', async () => {
    // Publishing, unpublishing, and placing a session nobody has been invited to all
    // arrive here with no `calendar`, and must not stamp a UID onto a row that has none.
    const fields = await schedule({ ...BASE })

    expect(fields).not.toHaveProperty('calendarUid')
    expect(fields).not.toHaveProperty('calendarSequence')
    expect(fields).not.toHaveProperty('calendarStatus')
    expect(fields).not.toHaveProperty('calendarDtstamp')
  })

  it('stores the first invite as SEQUENCE 0 rather than bumping it to 1', async () => {
    // The case the old writer could not express. A first invite at 1 makes the SECOND
    // invite a same-UID-same-SEQUENCE duplicate that clients discard.
    const fields = await schedule({
      ...BASE,
      calendar: { uid: 'sess-1@bodo', sequence: 0, status: 'active', dtstamp: DTSTAMP },
    })

    expect(fields.calendarUid).toBe('sess-1@bodo')
    expect(fields.calendarSequence).toBe(0)
    expect(fields.calendarStatus).toBe('active')
    expect(fields.calendarDtstamp).toBe(DTSTAMP)
  })

  it('stores a bumped sequence exactly as handed over', async () => {
    const fields = await schedule({
      ...BASE,
      calendar: { uid: 'sess-1@bodo', sequence: 5, status: 'active', dtstamp: DTSTAMP },
    })

    expect(fields.calendarSequence).toBe(5)
  })

  it('cancels when told to, rather than inferring it from scheduleStatus', async () => {
    // An unscheduled session with a stale time on it is worse than none: the speaker still
    // has the old slot in their calendar with no signal it is gone. Inferring `cancelled`
    // from `scheduleStatus` here got that right by accident and got the re-invite of a
    // cancelled session wrong, which the planner now decides.
    const fields = await schedule({
      submissionId: 'recSub1',
      eventId: 'recEvt1',
      scheduleStatus: 'unscheduled',
      calendar: { uid: 'sess-1@bodo', sequence: 3, status: 'cancelled', dtstamp: DTSTAMP },
    })

    expect(fields.calendarSequence).toBe(3)
    expect(fields.calendarStatus).toBe('cancelled')
  })

  it('re-activates a cancelled session that is scheduled again', async () => {
    const fields = await schedule({
      ...BASE,
      calendar: { uid: 'sess-1@bodo', sequence: 6, status: 'active', dtstamp: DTSTAMP },
    })

    expect(fields.calendarStatus).toBe('active')
  })

  it('still writes the schedule columns alongside the identity', async () => {
    const fields = await schedule({
      ...BASE,
      calendar: { uid: 'sess-1@bodo', sequence: 1, status: 'active', dtstamp: DTSTAMP },
    })

    expect(fields.startsAt).toBe('2026-10-12T17:00:00.000Z')
    expect(fields.endsAt).toBe('2026-10-12T17:30:00.000Z')
  })
})
