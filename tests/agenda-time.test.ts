import { describe, expect, it } from 'vitest'

import {
  dateKeyAt,
  durationMinutes,
  eventDateKeys,
  minutesAt,
  monthGridDateKeys,
  zonedDateTimeToIso,
} from '@/features/agenda/time'
import { parseCellId, scheduleAtCell } from '@/features/agenda/timeline/timeline-model'
import type { AgendaSession } from '@/features/agenda/types'

const SESSION: AgendaSession = {
  id: 'session-1',
  code: 'SESS-1',
  title: 'Testing schedules',
  status: 'accepted',
  source: 'manual',
  sourceName: 'Manual',
  tags: [],
  scheduleStatus: 'unscheduled',
  contentStatus: 'not_submitted',
  participants: [],
}

describe('agenda time projections', () => {
  it('uses the event timezone when deriving calendar dates', () => {
    expect(dateKeyAt('2026-10-13T01:00:00.000Z', 'America/Los_Angeles')).toBe('2026-10-12')
  })

  it('converts a local grid cell to a UTC instant', () => {
    expect(zonedDateTimeToIso('2026-10-12', 9 * 60, 'America/Los_Angeles')).toBe(
      '2026-10-12T16:00:00.000Z',
    )
  })

  it('lists event dates inclusively without reading the current clock', () => {
    expect(
      eventDateKeys('2026-10-12T09:00:00.000Z', '2026-10-14T23:00:00.000Z', 'America/Los_Angeles'),
    ).toEqual(['2026-10-12', '2026-10-13', '2026-10-14'])
  })

  it('builds a six-week Sunday-first month grid', () => {
    const dates = monthGridDateKeys('2026-10-12')

    expect(dates).toHaveLength(42)
    expect(dates.at(0)).toBe('2026-09-27')
    expect(dates.at(-1)).toBe('2026-11-07')
  })

  it('uses an existing session length and defaults an unscheduled row to 30 minutes', () => {
    expect(durationMinutes(SESSION)).toBe(30)
    expect(
      durationMinutes({
        startsAt: '2026-10-12T16:00:00.000Z',
        endsAt: '2026-10-12T17:15:00.000Z',
      }),
    ).toBe(75)
  })

  it('turns a tray drop into room, start, and default end fields', () => {
    expect(
      scheduleAtCell(
        SESSION,
        { roomId: 'room-1', dateKey: '2026-10-12', minute: 9 * 60 },
        'America/Los_Angeles',
      ),
    ).toEqual({
      submissionId: 'session-1',
      roomId: 'room-1',
      startsAt: '2026-10-12T16:00:00.000Z',
      endsAt: '2026-10-12T16:30:00.000Z',
    })
  })

  it('rejects malformed drop target ids', () => {
    expect(parseCellId('cell:missing')).toBeUndefined()
  })

  it('falls back to UTC on a timezone Intl refuses instead of throwing', () => {
    // `Events.timezone` is free text, so `Pacific Time` is a thing an organizer can type.
    // `Intl.DateTimeFormat` answers that with `RangeError: Invalid time zone specified`,
    // which used to take out every caller of this module: the agenda views, the .ics
    // builder, and the public agenda page, where it lands as a streamed error after the
    // shell has flushed. 17:00Z read as UTC is 17:00, which is what these assert.
    expect(dateKeyAt('2026-10-12T17:00:00.000Z', 'Pacific Time')).toBe('2026-10-12')
    expect(minutesAt('2026-10-12T17:00:00.000Z', 'Pacific Time')).toBe(17 * 60)

    // The same instant in a zone Intl does know, so the fallback is not swallowing
    // everything: 17:00Z is 10:00 in California.
    expect(minutesAt('2026-10-12T17:00:00.000Z', 'America/Los_Angeles')).toBe(10 * 60)
  })
})
