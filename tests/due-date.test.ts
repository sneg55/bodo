// What a typed deadline means.
//
// The bare-date case is the one that was missing, and its absence is why two task items
// were scored partial. Both drawers used `<input type="datetime-local">`, which yields the
// empty string unless the date AND the time are filled, so an organizer who picked a date
// and left the time alone created a task with no deadline and no error to explain it.

import { describe, expect, it } from 'vitest'

import { eventInstant } from '@/features/events/due-date'

const LA = 'America/Los_Angeles'

describe('eventInstant', () => {
  it('reads a bare date as the END of that day in the event zone', () => {
    // 23:59 Pacific on Sep 25 is 06:59 UTC on Sep 26. Storing midnight instead would make
    // "due the 25th" fall due the instant the 24th ended, a full day early.
    expect(eventInstant('2026-09-25', LA)).toBe('2026-09-26T06:59:00.000Z')
  })

  it('still accepts a full datetime-local, so nothing that already worked breaks', () => {
    expect(eventInstant('2026-09-25T09:00', LA)).toBe('2026-09-25T16:00:00.000Z')
  })

  it('handles a zone east of UTC, where end of day is the same calendar date', () => {
    expect(eventInstant('2026-09-25', 'Europe/Berlin')).toBe('2026-09-25T21:59:00.000Z')
  })

  it('is undefined for absent or blank input, which means no deadline', () => {
    expect(eventInstant(undefined, LA)).toBeUndefined()
    expect(eventInstant('', LA)).toBeUndefined()
    expect(eventInstant('   ', LA)).toBeUndefined()
  })

  it('passes a full instant through untouched', () => {
    // A caller that already has ISO keeps working rather than being re-interpreted as a
    // wall clock and shifted by the offset a second time.
    expect(eventInstant('2026-09-25T16:00:00.000Z', LA)).toBe('2026-09-25T16:00:00.000Z')
  })

  it('crosses a DST boundary without drifting an hour', () => {
    // US DST ends Nov 1 2026, so Nov 2 is standard time (UTC-8) while Oct 31 is not.
    expect(eventInstant('2026-10-31', LA)).toBe('2026-11-01T06:59:00.000Z')
    expect(eventInstant('2026-11-02', LA)).toBe('2026-11-03T07:59:00.000Z')
  })
})
