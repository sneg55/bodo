// The CFP builder's Close Date, as the control on step 6 now reads and writes it.
//
// WHAT CHANGED. The field was a bare `Input type="datetime-local"`, whose year segment accepts
// SIX digits: a deadline mistyped into the year 202600 was taken silently and the form then never
// closed. It is `DateTimeField` now, like every other date-time control in the app.
//
// WHY THIS FILE EXISTS. That primitive works in ISO INSTANTS and needs the zone those instants are
// to be read in, while `draft.closeDate` is `datetime-local` text carrying a wall clock and no
// zone at all (`draft.ts`). So `StepSettings` adapts between the two, and the adapter is only
// correct if it uses the EVENT's zone: the zone is not decoration there, because `DateTimeField`
// prints its abbreviation next to the value. Handing it UTC or the browser's zone would round-trip
// the instant correctly and print the WRONG abbreviation beside a published deadline, which is a
// worse defect than the six-digit year, and it is why the field was left alone until the zone
// could reach it.
//
// The adapter itself is two private functions inside a `'use client'` component, and this suite is
// `environment: 'node'` with no renderer (vitest.config.ts), so what is pinned here is the
// COMPOSITION they are built from: the same three calls out of `@/features/agenda/time` that the
// private helpers in `draft.ts` make, plus the abbreviation the control displays. If any of these
// moves, the control is wrong in the way this file describes.

import { describe, expect, it } from 'vitest'

import { dateKeyAt, minutesAt, zoneAbbrevAt, zonedDateTimeToIso } from '@/features/agenda/time'

/** The EVENT's zone. A close date is a wall-clock deadline in it, never in the runtime's. */
const ZONE = 'America/Los_Angeles'

/** `StepSettings.localInputToIso`, verbatim: draft text to the instant the control takes. */
function localInputToIso(local: string, timeZone: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/u.exec(local.trim())
  if (match === null) return undefined
  const [, dateKey = '', hour = '0', minute = '0'] = match
  return zonedDateTimeToIso(dateKey, Number(hour) * 60 + Number(minute), timeZone)
}

/** `StepSettings.isoToLocalInput`, verbatim: the control's instant back to draft text. */
function isoToLocalInput(iso: string | undefined, timeZone: string): string {
  if (iso === undefined) return ''
  const dateKey = dateKeyAt(iso, timeZone)
  const minutes = minutesAt(iso, timeZone)
  if (dateKey === undefined || minutes === undefined) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${dateKey}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

describe('the close date control reads the draft in the event zone', () => {
  it('turns the stored wall clock into the instant that wall clock names', () => {
    // 23:59 on September 15 in America/Los_Angeles is PDT, UTC-7, so it is 06:59Z on the 16th.
    // This is the same instant `toFormWrite` stores for the same text (builder-draft.test.ts),
    // which is the property that matters: the control cannot show one deadline and save another.
    expect(localInputToIso('2026-09-15T23:59', ZONE)).toBe('2026-09-16T06:59:00.000Z')
  })

  it('shows no value at all for a form with no deadline', () => {
    // `''` is how the draft spells "no close date", and `undefined` is how `DateTimeField` spells
    // an empty field. They have to line up or an unset deadline renders as a date.
    expect(localInputToIso('', ZONE)).toBeUndefined()
    expect(localInputToIso('   ', ZONE)).toBeUndefined()
  })

  it('writes the clear button back as the empty string the draft expects', () => {
    // The X on `DateTimeField` reports `undefined`. Storing that as anything but `''` would make
    // `toFormWrite` see a value it cannot parse rather than an absent deadline.
    expect(isoToLocalInput(undefined, ZONE)).toBe('')
  })

  it('round-trips to the minute, so opening the step and saving moves no deadline', () => {
    // The whole risk of putting an adapter between the draft and the control: a lossy pair would
    // shift every close date by opening step 6, which is the defect `draft.ts` already records
    // against reading the RUNTIME's zone instead of the event's.
    for (const local of ['2026-09-15T23:59', '2027-01-04T09:00', '2026-03-08T03:30']) {
      expect(isoToLocalInput(localInputToIso(local, ZONE), ZONE)).toBe(local)
    }
  })
})

describe('the close date control prints the event zone, not the runtime one', () => {
  it('names the event zone beside the deadline, across the DST boundary', () => {
    // This is the assertion the whole change was blocked on. `DateTimeField` renders
    // `zoneAbbrevAt(value, timeZone)` as a suffix, so with the event's zone threaded through, a
    // Californian event's deadline reads PDT in September and PST in January.
    const september = localInputToIso('2026-09-15T23:59', ZONE)
    const january = localInputToIso('2027-01-04T09:00', ZONE)

    expect(september).toBeDefined()
    expect(january).toBeDefined()
    expect(zoneAbbrevAt(september ?? '', ZONE)).toBe('PDT')
    expect(zoneAbbrevAt(january ?? '', ZONE)).toBe('PST')
  })

  it('would have printed a different zone had UTC been passed instead', () => {
    // Why passing UTC or the browser's zone was not an acceptable shortcut: the instant is the
    // same either way, so a round-trip test alone would have passed while the organizer read the
    // wrong zone off a published deadline.
    const iso = localInputToIso('2026-09-15T23:59', ZONE) ?? ''

    expect(zoneAbbrevAt(iso, 'UTC')).not.toBe('PDT')
  })
})
