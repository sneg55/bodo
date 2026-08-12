// How an event is presented in the switcher chip and the chooser row.
//
// These moved out of `AdminShellSlots.tsx` so both surfaces could share them, which is
// exactly when they became worth testing: previously one caller meant a wrong date range
// was visible in one place, and now a wrong one is visible in two that must agree.
//
// The timezone cases are the point. Every part of the range is formatted in the EVENT's
// zone rather than the server's, and the reason is not pedantry: the deployed Worker's
// zone is UTC, so an event that starts on the evening of the 12th in Los Angeles is
// already the 13th by UTC's reckoning, and the chip would name a day the conference does
// not start on.

import { describe, expect, it } from 'vitest'
import { eventChoices, eventDateRange, eventInitials } from '@/features/events/choices'
import type { Event, EventMembership } from '@/types/domain'

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'recEvent1',
    name: 'AI Engineer Sandbox',
    slug: 'ai-engineer-sandbox',
    eventType: 'Conference',
    timezone: 'America/Los_Angeles',
    status: 'open',
    accelSyncEnabled: false,
    ...overrides,
  }
}

function membership(overrides: Partial<EventMembership> = {}): EventMembership {
  return {
    id: 'recMem1',
    eventId: 'recEvent1',
    userId: 'recUser1',
    role: 'admin',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('eventInitials', () => {
  it('takes the first letter of the first two words', () => {
    // `AE`, not `AS`. The reference chip reads `AS` because Sessionboard's event is named
    // `AI.Engineer Sandbox`, which is two whitespace-separated words; the seeded one is
    // three. Pinned so nobody "corrects" the rule to match a screenshot of a different name.
    expect(eventInitials('AI Engineer Sandbox')).toBe('AE')
    expect(eventInitials('AI.Engineer Sandbox')).toBe('AS')
  })

  it('uppercases a lowercase name', () => {
    expect(eventInitials('rust conf')).toBe('RC')
  })

  it('handles a single word', () => {
    expect(eventInitials('Kubecon')).toBe('K')
  })

  it('ignores runs of whitespace rather than producing blank initials', () => {
    expect(eventInitials('  Data    Council  ')).toBe('DC')
  })

  it('returns an empty string for an empty name, rather than throwing', () => {
    // A new event is briefly nameless while the create form is being filled in.
    expect(eventInitials('   ')).toBe('')
  })
})

describe('eventDateRange', () => {
  it('renders a multi-day range', () => {
    expect(
      eventDateRange('2026-10-12T16:00:00.000Z', '2026-10-14T23:00:00.000Z', 'America/Los_Angeles'),
    ).toBe('Oct 12-14, 2026')
  })

  it('names both months when the event crosses one', () => {
    // The bug this test exists for: printing the month once from the start rendered an
    // Aug 31 to Sep 5 event as `Aug 31-5, 2026`, a range that counts backwards and puts
    // the second half in the wrong month. It shipped and was visible in a real event's
    // sidebar chip.
    expect(
      eventDateRange('2026-08-31T16:00:00.000Z', '2026-09-05T23:00:00.000Z', 'America/Los_Angeles'),
    ).toBe('Aug 31 - Sep 5, 2026')
  })

  it('names both years when the event crosses one', () => {
    expect(
      eventDateRange('2026-12-30T18:00:00.000Z', '2027-01-02T18:00:00.000Z', 'America/Los_Angeles'),
    ).toBe('Dec 30, 2026 - Jan 2, 2027')
  })

  it('renders a single day when there is no end', () => {
    expect(eventDateRange('2026-10-12T16:00:00.000Z', undefined, 'America/Los_Angeles')).toBe(
      'Oct 12, 2026',
    )
  })

  it('is empty when the event has no start date', () => {
    // The state a just-created event is in. A placeholder here would be a claim the
    // record does not make.
    expect(eventDateRange(undefined, undefined, 'America/Los_Angeles')).toBe('')
  })

  it('uses the event zone and not the runtime zone', () => {
    // 2026-10-13T02:00Z is still the evening of the 12th in Los Angeles. A server
    // formatting in UTC would name the wrong opening day.
    const instant = '2026-10-13T02:00:00.000Z'

    expect(eventDateRange(instant, undefined, 'America/Los_Angeles')).toBe('Oct 12, 2026')
    expect(eventDateRange(instant, undefined, 'UTC')).toBe('Oct 13, 2026')
  })

  it('takes the year from the start in the event zone', () => {
    // New Year's Eve in Los Angeles is already next year in UTC.
    expect(eventDateRange('2027-01-01T04:00:00.000Z', undefined, 'America/Los_Angeles')).toBe(
      'Dec 31, 2026',
    )
  })
})

describe('eventChoices', () => {
  it('carries the role held on each event, not a role read off the event', () => {
    const choices = eventChoices(
      [event(), event({ id: 'recEvent2', name: 'Rust Conf' })],
      [membership(), membership({ id: 'recMem2', eventId: 'recEvent2', role: 'reviewer' })],
    )

    expect(choices.map((choice) => choice.role)).toEqual(['admin', 'reviewer'])
  })

  it('drops an event the caller holds no membership on', () => {
    // Only reachable when a read races a revocation. Showing the row would offer a door
    // that is already shut, and the event page would then refuse them.
    const choices = eventChoices([event(), event({ id: 'recEvent2' })], [membership()])

    expect(choices.map((choice) => choice.id)).toEqual(['recEvent1'])
  })

  it('formats each row the way the sidebar chip formats the same event', () => {
    const choice = eventChoices(
      [event({ startsAt: '2026-10-12T16:00:00.000Z', endsAt: '2026-10-14T23:00:00.000Z' })],
      [membership()],
    ).at(0)

    expect(choice?.initials).toBe('AE')
    expect(choice?.dateRange).toBe('Oct 12-14, 2026')
  })

  it('returns nothing for an organizer with no memberships', () => {
    expect(eventChoices([], [])).toEqual([])
  })

  it('carries the event logo, so a row shows the mark rather than two letters', () => {
    const choices = eventChoices(
      [
        event({ logoUrl: 'https://cdn.example.com/aie.png' }),
        event({ id: 'recEvent2', name: 'Rust Conf' }),
      ],
      [membership(), membership({ id: 'recMem2', eventId: 'recEvent2' })],
    )

    expect(choices.map((choice) => choice.avatarUrl)).toEqual([
      'https://cdn.example.com/aie.png',
      undefined,
    ])
  })
})
