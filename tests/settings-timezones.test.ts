// The Timezone picker's option list.
//
// Pinned at fixed instants in zones that have no daylight saving, so these assertions do
// not drift with the calendar. The property that matters is the one that stops the
// RangeError this control exists to prevent: every offered value is a zone `Intl` accepts.

import { describe, expect, it } from 'vitest'

import { isValidTimezone } from '@/features/settings/checks'
import { timezoneLabel, timezoneOptions, zoneOffsetMinutes } from '@/features/settings/timezones'

/** 2026-01-15T12:00:00Z: northern winter, so the US zones are on standard time. */
const WINTER = Date.parse('2026-01-15T12:00:00.000Z')

describe('zoneOffsetMinutes', () => {
  it('reads a whole hour offset east and west of UTC', () => {
    expect(zoneOffsetMinutes('UTC', WINTER)).toBe(0)
    expect(zoneOffsetMinutes('Asia/Tokyo', WINTER)).toBe(9 * 60)
    expect(zoneOffsetMinutes('America/Los_Angeles', WINTER)).toBe(-8 * 60)
  })

  it('reads a half and three quarter hour offset', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', WINTER)).toBe(5 * 60 + 30)
    expect(zoneOffsetMinutes('Asia/Kathmandu', WINTER)).toBe(5 * 60 + 45)
  })

  it('is undefined for a zone Intl does not recognise', () => {
    expect(zoneOffsetMinutes('Pacific Time', WINTER)).toBe(undefined)
  })
})

describe('timezoneLabel', () => {
  it('matches the GMT-offset shape in the parity screenshot', () => {
    expect(timezoneLabel('America/Los_Angeles', WINTER)).toBe(
      '(GMT-8:00) America/Los_Angeles (Pacific Standard Time)',
    )
  })

  it('does not zero pad the hour, because the product does not', () => {
    expect(timezoneLabel('Asia/Tokyo', WINTER)).toContain('(GMT+9:00)')
  })

  it('renders a fractional offset with its minutes', () => {
    expect(timezoneLabel('Asia/Kolkata', WINTER)).toContain('(GMT+5:30)')
  })

  it('renders UTC as a zero offset', () => {
    expect(timezoneLabel('UTC', WINTER)).toContain('(GMT+0:00) UTC')
  })

  it('falls back to the bare id rather than inventing an offset', () => {
    expect(timezoneLabel('Pacific Time', WINTER)).toBe('Pacific Time')
  })
})

describe('timezoneOptions', () => {
  const options = timezoneOptions(WINTER)

  it('offers a usable number of zones', () => {
    expect(options.length).toBeGreaterThan(50)
  })

  it('offers UTC, which is what a blank column maps to', () => {
    expect(options.some((option) => option.value === 'UTC')).toBe(true)
  })

  it('offers only values the validator and Intl both accept', () => {
    // The whole point of the control: nothing selectable here can reach the agenda as
    // the free-text value that used to throw RangeError out of Intl.
    for (const option of options) {
      expect(isValidTimezone(option.value)).toBe(true)
    }
  })

  it('sorts west to east by offset', () => {
    const offsets = options.map((option) => zoneOffsetMinutes(option.value, WINTER) ?? 0)
    expect([...offsets].sort((left, right) => left - right)).toEqual(offsets)
  })

  it('labels every option, never leaving a raw id in the list', () => {
    for (const option of options) {
      expect(option.label).toContain(option.value)
      expect(option.label.startsWith('(GMT')).toBe(true)
    }
  })

  it('has no duplicate values, which would break the Select items lookup', () => {
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length)
  })
})
