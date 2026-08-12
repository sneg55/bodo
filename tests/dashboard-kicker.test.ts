// The event home's clock-dependent parts: the day kicker, the countdown, and the greeting.
//
// Split from dashboard-home.test.ts, which covers the counting. These are together because
// they share one property that is the whole reason they are pure: every one reads the
// EVENT's timezone rather than the viewer's, so an organizer in California looking at a
// Tokyo event sees the event's calendar and not their own.

import { describe, expect, it } from 'vitest'

import { dayKicker, daysToEvent, greeting } from '@/features/dashboard/home-view'

const EVENT = { startsAt: '2026-10-12T16:00:00.000Z', timezone: 'America/Los_Angeles' }

describe('daysToEvent', () => {
  it('counts whole dates in the event timezone, not hours from now', () => {
    // 2026-10-10T23:00Z is still 4pm on the 10th in California, so two dates remain. An
    // hours-based subtraction would answer 1, because 41 hours floors to 1 day.
    expect(daysToEvent(EVENT, new Date('2026-10-10T23:00:00.000Z'))).toBe(2)
  })

  it('does not flip a day early for a viewer whose own date has already turned', () => {
    // 2026-10-12T05:00Z is the 12th in UTC but still 10pm on the 11th in California, so
    // the event is tomorrow there. This is the case that makes the timezone read
    // load-bearing rather than decorative.
    expect(daysToEvent(EVENT, new Date('2026-10-12T05:00:00.000Z'))).toBe(1)
  })

  it('is 0 on the day itself, whatever the hour', () => {
    expect(daysToEvent(EVENT, new Date('2026-10-12T07:30:00.000Z'))).toBe(0)
    expect(daysToEvent(EVENT, new Date('2026-10-13T05:00:00.000Z'))).toBe(0)
  })

  it('goes negative once the event has started rather than clamping to 0', () => {
    // Not clamped on purpose: an event that has begun is a real state and the caller words
    // it, instead of this pretending the countdown is still running.
    expect(daysToEvent(EVENT, new Date('2026-10-15T16:00:00.000Z'))).toBe(-3)
  })

  it('answers undefined when the event has no start date', () => {
    expect(daysToEvent({ startsAt: undefined, timezone: 'UTC' }, new Date())).toBeUndefined()
  })
})

describe('dayKicker', () => {
  it('reads as the product does, with the countdown', () => {
    expect(dayKicker(EVENT, new Date('2026-08-08T19:00:00.000Z'))).toBe(
      'SATURDAY, AUGUST 8 · 65 DAYS TO EVENT',
    )
  })

  it('says day, not days, at one', () => {
    expect(dayKicker(EVENT, new Date('2026-10-11T19:00:00.000Z'))).toContain('1 DAY TO EVENT')
  })

  it('switches wording on the day and after it', () => {
    // Before the start INSTANT, not merely on the start date. This test used to assert
    // "EVENT STARTS TODAY" at 19:00Z, which is 10 hours after a 9am California opening, so it
    // encoded the wrong boundary rather than catching it. Found by Codex review.
    expect(dayKicker(EVENT, new Date('2026-10-12T07:00:00.000Z'))).toContain('EVENT STARTS TODAY')
    expect(dayKicker(EVENT, new Date('2026-10-20T19:00:00.000Z'))).toContain('EVENT STARTED')
  })

  it('says the event is under way once its start instant has passed', () => {
    // Still the same calendar day in the event's zone, so the day count cannot tell these
    // apart and the instant has to.
    expect(dayKicker(EVENT, new Date('2026-10-12T15:59:00.000Z'))).toContain('EVENT STARTS TODAY')
    expect(dayKicker(EVENT, new Date('2026-10-12T16:01:00.000Z'))).toContain('EVENT UNDER WAY')
    // Late evening in California is already the next date in UTC, and still day zero here.
    expect(dayKicker(EVENT, new Date('2026-10-13T05:00:00.000Z'))).toContain('EVENT UNDER WAY')
  })

  it('drops the countdown rather than printing NaN when there is no start date', () => {
    const kicker = dayKicker(
      { startsAt: undefined, timezone: 'UTC' },
      new Date('2026-08-08T19:00:00.000Z'),
    )
    expect(kicker).toBe('SATURDAY, AUGUST 8')
  })

  it('falls back to UTC on a timezone Intl refuses instead of throwing', () => {
    // `Events.timezone` is free text, and an unrecognised value used to take out every
    // agenda surface with a RangeError before time.ts guarded it. This is the same guard.
    expect(
      dayKicker(
        { startsAt: undefined, timezone: 'Pacific Time' },
        new Date('2026-08-08T19:00:00.000Z'),
      ),
    ).toBe('SATURDAY, AUGUST 8')
  })
})

describe('greeting', () => {
  it('picks the part of day in the event timezone', () => {
    // 16:00Z is 9am in California and 5pm in London: same instant, different greeting.
    expect(
      greeting({ timezone: 'America/Los_Angeles' }, new Date('2026-08-08T16:00:00.000Z'), 'Sw'),
    ).toBe('Good morning, Sw')
    expect(
      greeting({ timezone: 'Europe/London' }, new Date('2026-08-08T16:00:00.000Z'), 'Sw'),
    ).toBe('Good afternoon, Sw')
  })

  it('leaves the name off when there is not one, rather than trailing a comma', () => {
    expect(greeting({ timezone: 'UTC' }, new Date('2026-08-08T09:00:00.000Z'))).toBe('Good morning')
    expect(greeting({ timezone: 'UTC' }, new Date('2026-08-08T09:00:00.000Z'), '  ')).toBe(
      'Good morning',
    )
  })
})
