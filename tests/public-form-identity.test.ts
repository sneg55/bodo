// The event identity the public CFP page carries.
//
// The run scored CFP-03 against a page that said plenty about the FORM and nothing about
// the event it belonged to: no name, no dates, no logo, and a tab reading "Submit a
// session" for every event on the deployment.
//
// The date line is pre-rendered here rather than in the component for the same reason
// `deadlineLine` is: it is formatted in the EVENT's timezone, so the browser never needs
// the raw instants or the zone, and the server and the client cannot disagree about it.
// That is what these tests are really pinning.

import { describe, expect, it } from 'vitest'

import { toPublicForm } from '@/features/submissions/public-form'
import type { Event } from '@/types/domain'
import type { Form } from '@/types/forms'

const EVENT: Event = {
  id: 'evt1',
  name: 'AI Engineer Sandbox',
  slug: 'ai-engineer-sandbox',
  eventType: 'Conference',
  // Deliberately spanning midnight UTC in Los Angeles: 09:00 on the 12th Pacific is
  // 16:00 UTC, and an end of 01:00 UTC on the 15th is still the 14th there. Formatting
  // in the browser's zone would render the wrong last day for most of the world.
  startsAt: '2026-10-12T16:00:00.000Z',
  endsAt: '2026-10-15T01:00:00.000Z',
  timezone: 'America/Los_Angeles',
  status: 'open',
  accelSyncEnabled: false,
}

const FORM = {
  id: 'frm1',
  eventId: 'evt1',
  publicId: 'cfp2026',
  name: 'Internal CFP name',
  entityKind: 'abstracts',
  participantsEnabled: true,
  fields: [],
  participantFields: [],
  roles: [],
  crossFieldLimits: [],
  autoRedirectToPortal: false,
} as unknown as Form

describe('toPublicForm event identity', () => {
  it('carries the event name', () => {
    expect(toPublicForm(FORM, EVENT).eventName).toBe('AI Engineer Sandbox')
  })

  it('renders the date range in the EVENT timezone, not UTC', () => {
    // Oct 14 Pacific, not Oct 15 UTC. This is the whole reason it is pre-rendered.
    expect(toPublicForm(FORM, EVENT).eventDateLine).toBe('Oct 12-14, 2026')
  })

  it('omits the date line entirely for an event with no start date', () => {
    // A real state for an event still being planned. An empty string would render an
    // empty line, so it is normalised away rather than passed through.
    const undated = toPublicForm(FORM, { ...EVENT, startsAt: undefined, endsAt: undefined })
    expect(undated.eventDateLine).toBeUndefined()
  })

  it('passes the logo through, and omits it when the event has none', () => {
    expect(
      toPublicForm(FORM, { ...EVENT, logoUrl: 'https://cdn.example/logo.png' }).eventLogoUrl,
    ).toBe('https://cdn.example/logo.png')
    expect(toPublicForm(FORM, EVENT).eventLogoUrl).toBeUndefined()
  })

  it('keeps the internal form name out of the public shape as the heading', () => {
    // The internal name is the organizer's own label and is not participant-facing; the
    // Welcome step heads on `externalTitle` and falls back to rendering no heading.
    const published = toPublicForm(FORM, EVENT)
    expect(published.name).toBe('Internal CFP name')
    expect(published.externalTitle).toBeUndefined()
  })
})
