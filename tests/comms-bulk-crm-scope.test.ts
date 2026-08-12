// Scoping a CROSS-EVENT selection to one event. CRM-11.
//
// The CRM directory is cross-event by definition, so a selection of fifteen can span three
// conferences. A send is scoped to one chosen event, which is the only scoping under which
// `{{event.name}}` is true for every recipient. Two things have to hold, and they are what
// this file asserts:
//
//   1. Somebody who is not on the chosen event is NOT a recipient. This is structural rather
//      than promised: the selection is resolved against that event's own roster.
//   2. The exclusion is stated in the UI before the send, with the right numbers.
//
// The second is a sentence, and a sentence with "12 of 15" backwards reads fine in a
// component while misinforming every send, so it is built by a pure function and asserted
// directly.

import { describe, expect, it } from 'vitest'
import { scopeSummary } from '@/features/comms/BulkEmailScope'
import { bulkEmailRows } from '@/features/comms/bulk-compose'
import { assertSendable } from '@/features/comms/bulk-context'
import { resolveBulkRecipients } from '@/features/comms/bulk-recipients'
import type { Speaker } from '@/types/domain'

function speaker(id: string, firstName: string): Speaker {
  // `links` is required on `Speaker` and empty is its resting state, so it is spelled out
  // rather than cast away: a fixture that lies about the shape stops catching the change
  // that made it lie.
  return { id, email: `${id}@example.com`, firstName, lastName: 'Speaker', links: {} }
}

// Two conferences, and a person on each. The CRM shows both; a send can only go under one.
const summitRoster = [speaker('recAda', 'Ada'), speaker('recGrace', 'Grace')]
const selectionAcrossEvents = ['recAda', 'recGrace', 'recOnOtherConference']

describe('a cross-event selection resolved against one event', () => {
  it('drops the people who are not on the chosen event, and counts them', () => {
    const resolution = resolveBulkRecipients(summitRoster, selectionAcrossEvents)

    expect(resolution.recipients.map((row) => row.speakerId)).toEqual(['recAda', 'recGrace'])
    // `unknownIds` is what the CRM path surfaces as `notOnEvent`: on the roster it can only
    // mean a forged id, and from the directory it is the ordinary cross-event case.
    expect(resolution.unknownIds).toBe(1)
  })

  it('cannot name a conference a recipient is not part of', () => {
    // The safety property the whole design rests on. `bulkEmailRows` is fed the resolution,
    // and the resolution came from THIS event's roster, so there is no code path by which
    // somebody on another conference receives a body naming this one.
    const resolution = resolveBulkRecipients(summitRoster, selectionAcrossEvents)

    const rows = bulkEmailRows({
      eventId: 'recSummit',
      event: { name: 'AI Summit', slug: 'ai-summit' },
      recipients: resolution.recipients,
      subject: 'Travel for {{event.name}}',
      bodyHtml: '<p>Hi {{speaker.firstName}}, see you at {{event.name}}.</p>',
      portalUrl: 'https://bodo.example.com/portal',
      sendAt: '2026-08-10T09:00:00.000Z',
      sendId: '2026-08-10:abc',
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.toEmail)).toEqual(['recAda@example.com', 'recGrace@example.com'])
    // Nobody from another conference is in the batch at all, so no message names AI Summit
    // to somebody who is not on it.
    expect(rows.every((row) => row.payload.html.includes('AI Summit'))).toBe(true)
    expect(rows.some((row) => row.toEmail.includes('OtherConference'))).toBe(false)
  })

  it('logs every message under the chosen event', () => {
    // The other half of the requirement: the send has to be findable. One event id on every
    // row is what puts it in that event's Email history.
    const resolution = resolveBulkRecipients(summitRoster, selectionAcrossEvents)
    const rows = bulkEmailRows({
      eventId: 'recSummit',
      event: { name: 'AI Summit', slug: 'ai-summit' },
      recipients: resolution.recipients,
      subject: 'Travel',
      bodyHtml: '<p>Book by Friday</p>',
      portalUrl: 'https://bodo.example.com/portal',
      sendAt: '2026-08-10T09:00:00.000Z',
      sendId: '2026-08-10:abc',
    })

    expect(rows.every((row) => row.eventId === 'recSummit')).toBe(true)
  })
})

describe('assertSendable names WHICH emptiness stopped the send', () => {
  const draft = { subject: 'Travel', bodyHtml: '<p>Book by Friday</p>' }

  it('blames the event when the selection belongs to other conferences', () => {
    // From the CRM this is the ordinary cause, and telling that organizer "nobody has an
    // email address" would send them to check fifteen records for a problem none of them has.
    expect(() =>
      assertSendable({ ...draft, resolution: { recipients: [], unknownIds: 3 } }),
    ).toThrowError(/Pick the event they belong to/u)
  })

  it('blames the addresses when everybody selected is on the event', () => {
    expect(() =>
      assertSendable({ ...draft, resolution: { recipients: [], unknownIds: 0 } }),
    ).toThrowError(/has an email address on this event/u)
  })
})

describe('scopeSummary', () => {
  const full = { recipients: 2, notOnEvent: 0, skippedNoEmail: 0, skippedDuplicate: 0 }

  it('reads as pending until the resolution comes back', () => {
    // A line that is silent while it does not know teaches an organizer to read silence as
    // "everything is fine", which is exactly when it is not.
    expect(scopeSummary({ selected: 3, scope: undefined, eventName: 'AI Summit' })).toContain(
      'Checking',
    )
    expect(scopeSummary({ selected: 3, scope: full, eventName: undefined })).toContain('Checking')
  })

  it('states the count even when nobody is excluded', () => {
    expect(scopeSummary({ selected: 2, scope: full, eventName: 'AI Summit' })).toBe(
      '2 of 2 selected will be emailed under AI Summit.',
    )
  })

  it('names the excluded people and their cause', () => {
    const summary = scopeSummary({
      selected: 5,
      scope: { recipients: 2, notOnEvent: 2, skippedNoEmail: 1, skippedDuplicate: 0 },
      eventName: 'AI Summit',
    })

    expect(summary).toContain('2 of 5 selected will be emailed under AI Summit.')
    expect(summary).toContain('2 are not on this event and will not be emailed.')
    expect(summary).toContain('1 have no email address on file.')
    // The causes have different fixes, so an exclusion that did not happen is not mentioned.
    expect(summary).not.toContain('share an address')
  })

  it('mentions a collapsed duplicate address', () => {
    const summary = scopeSummary({
      selected: 3,
      scope: { recipients: 2, notOnEvent: 0, skippedNoEmail: 0, skippedDuplicate: 1 },
      eventName: 'AI Summit',
    })

    expect(summary).toContain('1 share an address with somebody already counted.')
  })
})
