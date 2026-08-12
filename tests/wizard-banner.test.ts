// The year on the public wizard's deadline sentence.
//
// Ref 16's string has no year and that is what a same-year deadline still gets, because the
// copy is transcribed and familiarity is scored. The case the reference never captured is a
// call for papers that closes in a LATER year: the run read "Form submissions will be
// accepted until April 30 at 4:59 PM PDT" on a form the admin list showed as closing
// Apr 30, 2027, eight months out, and a date with no year reads as one that has passed.
//
// `now` is passed explicitly in every case here. The default is the wall clock, which would
// make these assertions change meaning on January 1.

import { describe, expect, it } from 'vitest'

import { deadlineSentence } from '@/features/submissions/banner'

const ZONE = 'America/Los_Angeles'

describe('deadlineSentence year', () => {
  it('keeps ref 16 wording, with no year, for a deadline in the current year', () => {
    expect(
      deadlineSentence('2026-09-16T06:59:00.000Z', ZONE, new Date('2026-08-09T12:00:00.000Z')),
    ).toBe('Form submissions will be accepted until September 15 at 11:59 PM PDT.')
  })

  it('names the year for a deadline in a later one', () => {
    expect(
      deadlineSentence('2027-04-30T23:59:00.000Z', ZONE, new Date('2026-08-09T12:00:00.000Z')),
    ).toBe('Form submissions will be accepted until April 30, 2027 at 4:59 PM PDT.')
  })

  it('names the year for a deadline in an earlier one, which is a closed form', () => {
    expect(
      deadlineSentence('2025-09-16T06:59:00.000Z', ZONE, new Date('2026-08-09T12:00:00.000Z')),
    ).toBe('Form submissions will be accepted until September 15, 2025 at 11:59 PM PDT.')
  })

  it('decides the year in the EVENT timezone, not the runtime one', () => {
    // 2027-01-01T04:00Z is still December 31 2026 in Los Angeles, so a viewer read on the
    // first of January 2027 must not gain a year the event has not reached.
    expect(
      deadlineSentence('2027-01-01T04:00:00.000Z', ZONE, new Date('2026-12-31T20:00:00.000Z')),
    ).toBe('Form submissions will be accepted until December 31 at 8:00 PM PST.')
  })

  it('still has no sentence at all for an unparseable close date', () => {
    expect(deadlineSentence('not a date', 'UTC', new Date('2026-08-09T12:00:00.000Z'))).toBe(
      undefined,
    )
  })
})
