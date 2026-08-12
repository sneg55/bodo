// The visitor's own schedule: what survives a reload, and what lands in their calendar.
//
// The storage half is tested against hostile input rather than happy input, because that is
// what it will meet: this reads a value out of a browser's localStorage inside a
// third-party iframe, where the honest expectations are that it may be absent, stale,
// truncated by a quota, or written by an older version of the page. An iframe that throws
// on load is a blank rectangle on a conference's own website.

import { describe, expect, it } from 'vitest'

import {
  buildScheduleIcs,
  readSchedule,
  scheduleStorageKey,
  toggleScheduled,
  writeSchedule,
} from '@/features/cms/personal-schedule'

const KNOWN = ['s1', 's2', 's3']
const DTSTAMP = '2026-08-09T12:00:00.000Z'

describe('scheduleStorageKey', () => {
  it('is scoped per embed, not per event', () => {
    // One site can carry two embeds, a full agenda and a single-track list, and a visitor's
    // picks in one are not their picks in the other.
    expect(scheduleStorageKey('pub1')).not.toBe(scheduleStorageKey('pub2'))
  })
})

describe('readSchedule', () => {
  it('round-trips what was written', () => {
    expect(readSchedule(writeSchedule(['s2', 's1']), KNOWN)).toEqual(['s2', 's1'])
  })

  it('is empty when nothing has been stored', () => {
    expect(readSchedule(null, KNOWN)).toEqual([])
    expect(readSchedule('', KNOWN)).toEqual([])
  })

  it('is empty rather than throwing on a value it cannot parse', () => {
    // Quota truncation and a hand-edited value both look like this.
    expect(readSchedule('[not json', KNOWN)).toEqual([])
    expect(readSchedule('{"picks":["s1"]}', KNOWN)).toEqual([])
    expect(readSchedule('"s1"', KNOWN)).toEqual([])
  })

  it('drops entries that are not strings', () => {
    expect(readSchedule('["s1", 7, null, {"id":"s2"}]', KNOWN)).toEqual(['s1'])
  })

  it('drops a session that has left the agenda', () => {
    // Starred, then unpublished by the organizer. Keeping it would export a VEVENT with no
    // time, so it leaves the visitor's schedule instead.
    expect(readSchedule('["s1","gone","s3"]', KNOWN)).toEqual(['s1', 's3'])
  })

  it('deduplicates while keeping the order things were added in', () => {
    expect(readSchedule('["s3","s1","s3"]', KNOWN)).toEqual(['s3', 's1'])
  })
})

describe('toggleScheduled', () => {
  it('adds at the end and removes in place', () => {
    expect(toggleScheduled(['s1'], 's2')).toEqual(['s1', 's2'])
    expect(toggleScheduled(['s1', 's2', 's3'], 's2')).toEqual(['s1', 's3'])
  })
})

describe('buildScheduleIcs', () => {
  const session = {
    id: 's1',
    title: 'Agents that ship',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T16:30:00.000Z',
    room: 'Hall A',
  }

  it('emits a PUBLISH calendar, not an invitation', () => {
    // The whole difference from `buildInvite`: this is a calendar somebody imports for
    // themselves, so there is nobody to RSVP to and no organizer to reply to.
    const ics = buildScheduleIcs({ eventName: 'Sandbox', sessions: [session], dtstamp: DTSTAMP })

    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).not.toContain('ORGANIZER')
    expect(ics).not.toContain('ATTENDEE')
    expect(ics).not.toContain('SEQUENCE')
  })

  it('writes one VEVENT per session with its real instants', () => {
    const ics = buildScheduleIcs({
      eventName: 'Sandbox',
      sessions: [session, { ...session, id: 's2', title: 'Retrieval', room: undefined }],
      dtstamp: DTSTAMP,
    })

    expect(ics.match(/BEGIN:VEVENT/gu)).toHaveLength(2)
    expect(ics).toContain('DTSTART:20261012T160000Z')
    expect(ics).toContain('DTEND:20261012T163000Z')
    expect(ics).toContain('LOCATION:Hall A')
  })

  it('gives each session a stable UID, so re-importing updates rather than duplicates', () => {
    const once = buildScheduleIcs({ eventName: 'Sandbox', sessions: [session], dtstamp: DTSTAMP })
    const again = buildScheduleIcs({
      eventName: 'Sandbox',
      sessions: [session],
      dtstamp: '2026-08-10T09:00:00.000Z',
    })

    expect(once).toContain('UID:s1@bodo')
    expect(again).toContain('UID:s1@bodo')
  })

  it('skips a session with no time rather than inventing one', () => {
    // An agenda can hold a session whose slot is still to be announced. Guessing an hour
    // for it would put a wrong time in somebody's calendar.
    const ics = buildScheduleIcs({
      eventName: 'Sandbox',
      sessions: [{ id: 's9', title: 'To be announced' }, session],
      dtstamp: DTSTAMP,
    })

    expect(ics.match(/BEGIN:VEVENT/gu)).toHaveLength(1)
    expect(ics).not.toContain('To be announced')
  })

  it('escapes the separators the format reserves', () => {
    const ics = buildScheduleIcs({
      eventName: 'Sandbox',
      sessions: [{ ...session, title: 'Retrieval; scaling, and you' }],
      dtstamp: DTSTAMP,
    })

    expect(ics).toContain('SUMMARY:Retrieval\\; scaling\\, and you')
  })

  it('terminates every line with CRLF, which the format requires', () => {
    const ics = buildScheduleIcs({ eventName: 'Sandbox', sessions: [session], dtstamp: DTSTAMP })

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').length).toBeGreaterThan(5)
  })

  it('still produces a valid empty calendar when nothing is starred', () => {
    const ics = buildScheduleIcs({ eventName: 'Sandbox', sessions: [], dtstamp: DTSTAMP })

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})
