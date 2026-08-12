// What the speaker profile reads, and the two rules that keep it inside the viewer's
// scope: a speaker outside the scope is not reachable at all, and mail sent for somebody
// else's event never reaches the timeline.
//
// The DAL is mocked, so what is under test is the composition. The pure halves
// (`sessionsForSpeaker`, `profileEventIds`) are asserted directly. `timelineRows` moved to
// `crm-timeline.test.ts` with the function itself, and the one clock the whole profile is
// rendered on is pinned there and in `crm-profile-timezone.test.ts`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrmScope } from '@/features/crm/scope'

const mocks = vi.hoisted(() => ({
  listSpeakersInEvents: vi.fn(),
  listSubmissions: vi.fn(),
  listSpeakerTags: vi.fn(),
  listSpeakerTagIds: vi.fn(),
  listOutboxForSpeaker: vi.fn(),
  getEvent: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSpeakersInEvents: mocks.listSpeakersInEvents,
  listSubmissions: mocks.listSubmissions,
  listSpeakerTags: mocks.listSpeakerTags,
  listSpeakerTagIds: mocks.listSpeakerTagIds,
  listOutboxForSpeaker: mocks.listOutboxForSpeaker,
  getEvent: mocks.getEvent,
}))

const { editableEventId, loadSpeakerProfile, profileEventIds, sessionsForSpeaker } = await import(
  '@/features/crm/profile'
)

const SCOPE: CrmScope = {
  userId: 'usr1',
  eventIds: ['e1', 'e2'],
  adminEventIds: ['e1', 'e2'],
  contextEventId: 'e1',
}

const speaker = (id: string, eventIds: string[] = ['e1']) => ({
  speaker: { id, email: `${id}@example.com`, firstName: 'Ada', lastName: 'Okafor', links: {} },
  eventIds,
})

const participant = (speakerId: string, role: string) => ({
  id: `p-${speakerId}-${role}`,
  submissionId: 's1',
  speakerId,
  role,
  isPrimary: true,
  sortOrder: 0,
  speaker: { id: speakerId, email: 'x@example.com', firstName: '', lastName: '', links: {} },
})

const submission = (id: string, title: string, participants: unknown[], status = 'accepted') => ({
  id,
  eventId: 'e1',
  code: id,
  title,
  status,
  source: 'form',
  reviewRequired: true,
  answers: {},
  tagIds: [],
  scheduleStatus: 'unscheduled',
  calendarSequence: 0,
  calendarStatus: 'active',
  participants,
})

const outbox = (id: string, eventId: string, sendAt: string) => ({
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
})

const event = (id: string, name: string, timezone = 'UTC') => ({
  id,
  name,
  slug: name.toLowerCase(),
  eventType: 'conference',
  timezone,
  status: 'open',
  accelSyncEnabled: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listSpeakersInEvents.mockResolvedValue([speaker('spk1')])
  mocks.listSubmissions.mockResolvedValue([])
  mocks.listSpeakerTags.mockResolvedValue([])
  mocks.listSpeakerTagIds.mockResolvedValue([])
  mocks.listOutboxForSpeaker.mockResolvedValue([])
  mocks.getEvent.mockImplementation((id: string) => Promise.resolve(event(id, `Event ${id}`)))
})

describe('sessionsForSpeaker', () => {
  it('keeps only the submissions this speaker is cast in', () => {
    const sessions = sessionsForSpeaker('spk1', [
      submission('s1', 'Mine', [participant('spk1', 'speaker')]),
      submission('s2', 'Theirs', [participant('spk2', 'speaker')]),
    ] as never)
    expect(sessions.map((session) => session.title)).toEqual(['Mine'])
  })

  it('collects both roles when one person holds two on one submission', () => {
    const sessions = sessionsForSpeaker('spk1', [
      submission('s1', 'Panel', [
        participant('spk1', 'speaker'),
        participant('spk1', 'chairperson'),
      ]),
    ] as never)
    expect(sessions).toHaveLength(1)
    expect(sessions.map((session) => session.roles)).toEqual([['speaker', 'chairperson']])
  })

  it('deduplicates a role repeated on two participant rows', () => {
    const sessions = sessionsForSpeaker('spk1', [
      submission('s1', 'Panel', [
        { ...participant('spk1', 'speaker'), id: 'p1' },
        { ...participant('spk1', 'speaker'), id: 'p2' },
      ]),
    ] as never)
    expect(sessions.map((session) => session.roles)).toEqual([['speaker']])
  })

  it('is empty for an event with no submissions', () => {
    expect(sessionsForSpeaker('spk1', [])).toEqual([])
  })
})

describe('profileEventIds', () => {
  it("intersects with the viewer's scope and keeps the viewer's order", () => {
    expect(profileEventIds(SCOPE, ['e2', 'e9', 'e1'])).toEqual(['e1', 'e2'])
  })

  it('drops an event the speaker is on that the viewer is not a member of', () => {
    expect(profileEventIds(SCOPE, ['e9'])).toEqual([])
  })
})

describe('editableEventId', () => {
  // The reviewer case is the one that matters: it is what decides whether the Edit button
  // renders at all, and the read scope that got them onto the page says nothing about it.
  const reviewer: CrmScope = { ...SCOPE, adminEventIds: [] }

  it('picks the first event in the profile order the viewer is an admin on', () => {
    expect(editableEventId(SCOPE, ['e1', 'e2'])).toBe('e1')
  })

  it('skips an event the viewer only reviews on', () => {
    expect(editableEventId({ ...SCOPE, adminEventIds: ['e2'] }, ['e1', 'e2'])).toBe('e2')
  })

  it('answers undefined for a reviewer, which is what hides the Edit button', () => {
    expect(editableEventId(reviewer, ['e1', 'e2'])).toBeUndefined()
  })

  it("answers undefined when the speaker is on none of the viewer's admin events", () => {
    // Admin somewhere, but not anywhere this person appears. The action would refuse the
    // write for exactly this reason, so the button must not offer it.
    expect(editableEventId({ ...SCOPE, adminEventIds: ['e2'] }, ['e1'])).toBeUndefined()
  })

  it('answers undefined for a speaker with no in-scope events at all', () => {
    expect(editableEventId(SCOPE, [])).toBeUndefined()
  })
})

describe('loadSpeakerProfile', () => {
  it('is undefined for a speaker the roster read does not return', async () => {
    expect(await loadSpeakerProfile(SCOPE, 'spk-does-not-exist')).toBeUndefined()
  })

  it('answers the same for an id outside the scope as for one that does not exist', async () => {
    // The roster read has already intersected with the scope, so a speaker on somebody
    // else's event is simply absent from it. Both cases must reach the page as undefined.
    mocks.listSpeakersInEvents.mockResolvedValue([])
    expect(await loadSpeakerProfile(SCOPE, 'spk1')).toBeUndefined()
  })

  it('asks the roster read for the viewer scope and nothing wider', async () => {
    await loadSpeakerProfile(SCOPE, 'spk1')
    expect(mocks.listSpeakersInEvents).toHaveBeenCalledWith(['e1', 'e2'])
  })

  it('reads sessions only for the events the speaker is on', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([speaker('spk1', ['e2'])])
    await loadSpeakerProfile(SCOPE, 'spk1')
    expect(mocks.listSubmissions.mock.calls).toEqual([['e2']])
  })

  it('groups sessions under their event and totals them', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([speaker('spk1', ['e1', 'e2'])])
    mocks.listSubmissions.mockResolvedValue([
      submission('s1', 'Keynote', [participant('spk1', 'speaker')]),
    ] as never)

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.events.map((profileEvent) => profileEvent.name)).toEqual(['Event e1', 'Event e2'])
    expect(view?.sessionCount).toBe(2)
  })

  it("drops mail sent for an event outside the viewer's scope", async () => {
    mocks.listOutboxForSpeaker.mockResolvedValue([
      outbox('mine', 'e1', '2026-01-01T00:00:00.000Z'),
      outbox('theirs', 'e9', '2026-02-01T00:00:00.000Z'),
    ] as never)

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.timeline.map((row) => row.id)).toEqual(['mine'])
  })

  it('resolves tag ids through the vocabulary and drops one it does not know', async () => {
    mocks.listSpeakerTags.mockResolvedValue([{ id: 'tag1', name: 'Keynote', color: '#2563eb' }])
    mocks.listSpeakerTagIds.mockResolvedValue(['tag1', 'tag-deleted'])

    const view = await loadSpeakerProfile(SCOPE, 'spk1')
    expect(view?.tags.map((tag) => tag.name)).toEqual(['Keynote'])
  })
})
