// THE ONE CLOCK a CRM profile is read on.
//
// The eval run of 2026-08-10 reported the Communication tab stamping times about seven hours
// off the notes and stage moves on the same contact. It was not an offset and it was not the
// comms feature: the profile ran three rendering rules at once. The timeline rendered each
// row in ITS OWN event's zone, the two activity feeds rendered in the FIRST event's zone, and
// a mail whose event had dropped off the profile silently rendered in UTC. Nothing on the
// surface said which clock any line was on, so a contact spanning an `America/Los_Angeles`
// event and a UTC one showed one list under two clocks in August, when Los Angeles is UTC-7.
//
// What is pinned here is the rule that replaced them, end to end through `loadSpeakerProfile`
// because the defect was in the ASSEMBLY rather than in any one renderer:
//
//   1. A contact spanning two events in different zones renders every timestamp, on every
//      surface, on ONE clock.
//   2. Every timestamp names that clock, so a row whose event is missing cannot pass UTC off
//      as local time.
//   3. The zone name follows daylight saving per timestamp, not once per page.
//
// The DAL is mocked. Both activity tables are read best-effort in the profile
// (`loadProfileActivity` catches), so they are mocked to resolve rather than to reject.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrmScope } from '@/features/crm/scope'

const mocks = vi.hoisted(() => ({
  listSpeakersInEvents: vi.fn(),
  listSubmissions: vi.fn(),
  listSpeakerTags: vi.fn(),
  listSpeakerTagIds: vi.fn(),
  listOutboxForSpeaker: vi.fn(),
  getEvent: vi.fn(),
  listSpeakerNotes: vi.fn(),
  listSpeakerStageChanges: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSpeakersInEvents: mocks.listSpeakersInEvents,
  listSubmissions: mocks.listSubmissions,
  listSpeakerTags: mocks.listSpeakerTags,
  listSpeakerTagIds: mocks.listSpeakerTagIds,
  listOutboxForSpeaker: mocks.listOutboxForSpeaker,
  getEvent: mocks.getEvent,
}))

vi.mock('@/services/airtable/speaker-notes', () => ({ listSpeakerNotes: mocks.listSpeakerNotes }))

vi.mock('@/services/airtable/speaker-stage-history', () => ({
  listSpeakerStageChanges: mocks.listSpeakerStageChanges,
}))

const { loadSpeakerProfile } = await import('@/features/crm/profile')
const { NO_EVENT_ZONE, profileTimezone, zoneAbbreviation, zonedDateTimeText } = await import(
  '@/features/crm/profile-activity'
)

const SCOPE: CrmScope = {
  userId: 'usr1',
  eventIds: ['e1', 'e2'],
  adminEventIds: ['e1', 'e2'],
  contextEventId: 'e1',
}

/** August, so `America/Los_Angeles` is UTC-7 and the reported shape is reproducible. */
const AUGUST = '2026-08-10T21:38:00.000Z'

const ZONES: ReadonlyMap<string, string> = new Map([
  ['e1', 'America/Los_Angeles'],
  ['e2', 'UTC'],
])

const outbox = (id: string, eventId: string, sendAt: string, sentAt?: string) => ({
  id,
  eventId,
  speakerId: 'spk1',
  templateSource: 'template',
  idempotencyKey: id,
  payload: { subject: `Subject ${id}`, html: '', attachIcs: false },
  toEmail: 'ada@example.com',
  sendAt,
  status: 'sent',
  attempts: 1,
  ...(sentAt === undefined ? {} : { sentAt }),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listSpeakersInEvents.mockResolvedValue([
    {
      speaker: {
        id: 'spk1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        links: {},
        invitedAt: AUGUST,
      },
      eventIds: ['e1', 'e2'],
    },
  ])
  mocks.listSubmissions.mockResolvedValue([])
  mocks.listSpeakerTags.mockResolvedValue([])
  mocks.listSpeakerTagIds.mockResolvedValue([])
  mocks.listOutboxForSpeaker.mockResolvedValue([])
  mocks.listSpeakerNotes.mockResolvedValue([])
  mocks.listSpeakerStageChanges.mockResolvedValue([])
  mocks.getEvent.mockImplementation((id: string) =>
    Promise.resolve({
      id,
      name: `Event ${id}`,
      slug: id,
      eventType: 'conference',
      timezone: ZONES.get(id) ?? 'UTC',
      status: 'open',
      accelSyncEnabled: false,
    }),
  )
})

describe('profileTimezone', () => {
  it("takes the contact's first in-scope event's zone", () => {
    expect(profileTimezone([{ timezone: 'Europe/Berlin' }, { timezone: 'UTC' }])).toBe(
      'Europe/Berlin',
    )
  })

  it('falls back for a contact on no event at all', () => {
    expect(profileTimezone([])).toBe(NO_EVENT_ZONE)
  })

  it('falls back rather than throwing on a zone Intl does not know', () => {
    // `Events.timezone` is a free-text column and `Intl.DateTimeFormat` throws `RangeError`
    // on anything with a space in it. `features/agenda/time.ts` records the same outage.
    expect(profileTimezone([{ timezone: 'Pacific Time' }])).toBe(NO_EVENT_ZONE)
  })
})

describe('zonedDateTimeText', () => {
  it('names the clock on the value', () => {
    expect(zonedDateTimeText(AUGUST, 'America/Los_Angeles')).toBe('Aug 10, 2026, 2:38 PM PDT')
  })

  it('names the UTC fallback rather than leaving it to look local', () => {
    expect(zonedDateTimeText(AUGUST, 'UTC')).toBe('Aug 10, 2026, 9:38 PM UTC')
  })

  it('is empty for an absent or unparseable instant, as dateTimeText is', () => {
    expect(zonedDateTimeText(undefined, 'UTC')).toBe('')
    expect(zonedDateTimeText('not a date', 'UTC')).toBe('')
  })
})

describe('zoneAbbreviation', () => {
  it('follows daylight saving, which is why it is derived per timestamp', () => {
    expect(zoneAbbreviation(AUGUST, 'America/Los_Angeles')).toBe('PDT')
    expect(zoneAbbreviation('2026-01-10T21:38:00.000Z', 'America/Los_Angeles')).toBe('PST')
  })

  it('answers an offset for a zone with no abbreviation, which is still informative', () => {
    expect(zoneAbbreviation(AUGUST, 'Europe/Berlin')).toBe('GMT+2')
  })

  it('is empty for a zone Intl rejects, so nothing is suffixed with a guess', () => {
    expect(zoneAbbreviation(AUGUST, 'Pacific Time')).toBe('')
  })
})

describe('loadSpeakerProfile: one clock across the whole profile', () => {
  // The reported case, reproduced: two mails 27 minutes apart, one for each event.
  const twoEvents = () => {
    mocks.listOutboxForSpeaker.mockResolvedValue([
      outbox('devflow', 'e1', AUGUST),
      outbox('sandbox', 'e2', '2026-08-10T22:05:00.000Z'),
    ])
  }

  it('renders mail for two events in different zones on one clock', async () => {
    twoEvents()
    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    // Newest first. 27 minutes apart on the page because they are 27 minutes apart in fact;
    // before the fix the second row was rendered in `e2`'s UTC and read as 7 hours later.
    expect(view?.timeline.map((row) => [row.eventName, row.atText])).toEqual([
      ['Event e2', 'Aug 10, 2026, 3:05 PM PDT'],
      ['Event e1', 'Aug 10, 2026, 2:38 PM PDT'],
    ])
  })

  it('puts the notes, the stage history and Last invited on that same clock', async () => {
    twoEvents()
    mocks.listSpeakerNotes.mockResolvedValue([
      { id: 'n1', speakerId: 'spk1', body: 'Said yes', authorName: 'Mia', at: AUGUST },
    ])
    mocks.listSpeakerStageChanges.mockResolvedValue([
      { id: 'h1', speakerId: 'spk1', from: '', to: 'invited', authorName: 'Mia', at: AUGUST },
    ])

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    const stamped = 'Aug 10, 2026, 2:38 PM PDT'
    // The four surfaces the profile stamps. All four on one string for one instant is the
    // whole rule: an organizer comparing a note against the mail it explains must be able to.
    expect(view?.activity.notes.map((note) => note.atText)).toEqual([stamped])
    expect(view?.activity.stageHistory.map((entry) => entry.atText)).toEqual([stamped])
    expect(view?.invitedAtText).toBe(stamped)
    expect(view?.timeline.at(-1)?.atText).toBe(stamped)
  })

  it('does not silently claim UTC for a mail whose event left the profile', async () => {
    // In scope (so `scopedOutbox` keeps it) but not on the contact any more, so there is no
    // event to name it after. It used to be the one row rendered in UTC with nothing saying
    // so. The name is gone; the clock is the profile's, and it is stated.
    mocks.listSpeakersInEvents.mockResolvedValue([
      {
        speaker: {
          id: 'spk1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: '',
          links: {},
        },
        eventIds: ['e1'],
      },
    ])
    mocks.listOutboxForSpeaker.mockResolvedValue([outbox('unlinked', 'e2', AUGUST)])

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.timeline.map((row) => [row.eventName, row.atText])).toEqual([
      [undefined, 'Aug 10, 2026, 2:38 PM PDT'],
    ])
  })

  it('states the fallback zone for a contact whose only event has an unusable timezone', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      {
        speaker: {
          id: 'spk1',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: '',
          links: {},
        },
        eventIds: ['e1'],
      },
    ])
    mocks.getEvent.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        name: `Event ${id}`,
        slug: id,
        eventType: 'conference',
        timezone: 'Pacific Time',
        status: 'open',
        accelSyncEnabled: false,
      }),
    )
    mocks.listOutboxForSpeaker.mockResolvedValue([outbox('one', 'e1', AUGUST)])

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.timeline.map((row) => row.atText)).toEqual(['Aug 10, 2026, 9:38 PM UTC'])
  })

  it('shows the send beside the schedule only when the two are different minutes', async () => {
    mocks.listOutboxForSpeaker.mockResolvedValue([
      outbox('late', 'e1', AUGUST, '2026-08-11T09:00:00.000Z'),
      outbox('prompt', 'e2', '2026-08-09T21:38:00.000Z', '2026-08-09T21:38:12.000Z'),
    ])

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.timeline.map((row) => [row.id, row.sentAtText])).toEqual([
      ['late', 'Aug 11, 2026, 2:00 AM PDT'],
      ['prompt', undefined],
    ])
  })
})
