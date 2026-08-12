// What the directory reads and how it folds those reads into one row set.
//
// The DAL is mocked, so what is under test is the composition: that the roster and the
// Events count come from ONE cross-event read rather than one read per event, that only
// the Sessions count is per event, and that the query engine runs in the order
// search -> filter -> sort -> page rather than paging first.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import type { CrmQueryState } from '@/features/crm/directory-query'

const mocks = vi.hoisted(() => ({
  listSpeakersInEvents: vi.fn(),
  listSubmissions: vi.fn(),
  listSpeakerTags: vi.fn(),
  listSpeakerTagMembership: vi.fn(),
  listSpeakerLists: vi.fn(),
  // `loadAddableEvents` names the viewer's admin events so the Add Contact dialog can offer
  // them, and it reads one record per event to do it. Mocked here rather than mocked away, so
  // that read stays visible in this file's own accounting of what the directory issues.
  getEvent: vi.fn(),
}))

vi.mock('@/services/airtable/queries', () => ({
  listSpeakersInEvents: mocks.listSpeakersInEvents,
  listSubmissions: mocks.listSubmissions,
  listSpeakerTags: mocks.listSpeakerTags,
  listSpeakerTagMembership: mocks.listSpeakerTagMembership,
  listSpeakerLists: mocks.listSpeakerLists,
  getEvent: mocks.getEvent,
}))

const { loadCrmDirectory, tagsBySpeaker } = await import('@/features/crm/directory')

const KEYNOTE = { id: 'tag1', name: 'Keynote', color: '#2563eb' }
const ALUMNI = { id: 'tag2', name: 'Alumni', color: '#16a34a' }

/**
 * One roster entry as `listSpeakersInEvents` returns it: the speaker plus the events of
 * the viewer's that they are on. `eventIds` defaults to one event, because that is the
 * ordinary case; the tests that care about the Events count pass their own.
 */
const speaker = (id: string, last: string, company?: string, eventIds: string[] = ['e1']) => ({
  speaker: { id, email: `${id}@example.com`, firstName: 'Ada', lastName: last, company, links: {} },
  eventIds,
})

const scope = {
  userId: 'usr1',
  eventIds: ['e1', 'e2'],
  adminEventIds: ['e1', 'e2'],
  contextEventId: 'e1',
}

const QUERY: CrmQueryState = {
  search: '',
  sort: null,
  filters: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  duplicatesOnly: false,
}

const cast = (...speakerIds: string[]) => ({
  participants: speakerIds.map((id) => ({ speaker: { id } })),
})

beforeEach(() => {
  mocks.listSpeakersInEvents.mockReset()
  mocks.listSubmissions.mockReset()
  mocks.listSpeakerTags.mockReset()
  mocks.listSpeakerTagMembership.mockReset()
  mocks.listSpeakerLists.mockReset()
  mocks.getEvent.mockReset()
  mocks.getEvent.mockImplementation((eventId: string) =>
    Promise.resolve({ id: eventId, name: `Event ${eventId}` }),
  )
  mocks.listSubmissions.mockResolvedValue([])
  mocks.listSpeakerTags.mockResolvedValue([])
  mocks.listSpeakerTagMembership.mockResolvedValue(new Map())
  mocks.listSpeakerLists.mockResolvedValue([])
})

describe('tagsBySpeaker', () => {
  it('joins membership ids to the vocabulary', () => {
    const joined = tagsBySpeaker(new Map([['spk1', ['tag1', 'tag2']]]), [KEYNOTE, ALUMNI])
    expect(joined.get('spk1')).toEqual([KEYNOTE, ALUMNI])
  })

  it('drops an id the vocabulary no longer has, rather than rendering a blank chip', () => {
    // The two reads share a cache tag but not a cache entry, so a tag deleted between them
    // is a real if narrow window.
    const joined = tagsBySpeaker(new Map([['spk1', ['tag1', 'tag9']]]), [KEYNOTE])
    expect(joined.get('spk1')).toEqual([KEYNOTE])
  })
})

describe('loadCrmDirectory', () => {
  it('reads the roster ONCE for the whole scope, and only sessions per event', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([speaker('spk1', 'Lovelace')])

    await loadCrmDirectory(scope, QUERY)

    // The Events count rides along on this one read. It used to cost an extra
    // `listSpeakers(eventId)` per event, which was the same whole-table scan repeated.
    expect(mocks.listSpeakersInEvents).toHaveBeenCalledExactlyOnceWith(['e1', 'e2'])
    // Sessions genuinely are per event: a different table, a different tag, different rows.
    expect(mocks.listSubmissions.mock.calls).toEqual([['e1'], ['e2']])
  })

  it('counts the events and sessions a speaker is on across the scope', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace', undefined, ['e1', 'e2']),
    ])
    mocks.listSubmissions.mockImplementation((eventId: string) =>
      Promise.resolve(eventId === 'e1' ? [cast('spk1'), cast('spk1', 'spk2')] : []),
    )

    const view = await loadCrmDirectory(scope, QUERY)

    expect(view.rows[0]).toMatchObject({ eventCount: 2, sessionCount: 2 })
  })

  it('reads one event and no sessions for an import who has submitted nothing', async () => {
    // The shape the Events count exists to tell apart: on your event, cast in nothing.
    // Deriving that count from submissions instead would report zero events for every
    // speaker a CSV import just created.
    mocks.listSpeakersInEvents.mockResolvedValue([speaker('spk9', 'Nobody')])

    const view = await loadCrmDirectory(scope, QUERY)

    expect(view.rows[0]).toMatchObject({ eventCount: 1, sessionCount: 0 })
  })

  it('searches across the whole scope before paging, not within the page', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace', 'Analytical Engines'),
      speaker('spk2', 'Hopper', 'Navy'),
      speaker('spk3', 'Johnson', 'NASA'),
    ])

    const view = await loadCrmDirectory(scope, { ...QUERY, search: 'navy', pageSize: 25 })

    expect(view.rows.map((row) => row.speaker.id)).toEqual(['spk2'])
    expect(view.totalRows).toBe(1)
    // The header counts the scope, not the query: a subtitle that changed with every
    // keystroke would stop being a fact about the CRM.
    expect(view.speakerCount).toBe(3)
    expect(view.eventCount).toBe(2)
  })

  it('sorts on a count and clamps a page past the end', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace'),
      speaker('spk2', 'Hopper'),
    ])
    mocks.listSubmissions.mockImplementation((eventId: string) =>
      Promise.resolve(eventId === 'e1' ? [cast('spk2'), cast('spk2')] : []),
    )

    const view = await loadCrmDirectory(scope, {
      ...QUERY,
      sort: { key: 'sessionCount', direction: 'desc' },
      page: 9,
      pageSize: 25,
    })

    expect(view.page).toBe(1)
    expect(view.rows.map((row) => row.speaker.id)).toEqual(['spk2', 'spk1'])
  })

  it('attaches each speaker their own tags, from one read for the whole scope', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace'),
      speaker('spk2', 'Hopper'),
    ])
    mocks.listSpeakerTags.mockResolvedValue([KEYNOTE, ALUMNI])
    mocks.listSpeakerTagMembership.mockResolvedValue(
      new Map([
        ['spk1', ['tag1', 'tag2']],
        ['spk2', ['tag2']],
      ]),
    )

    const view = await loadCrmDirectory(scope, QUERY)

    expect(view.rows[0].tags).toEqual([KEYNOTE, ALUMNI])
    expect(view.rows[1].tags).toEqual([ALUMNI])
    // Once for the whole directory, not once per row: per-row is the fan-out the Airtable
    // scheduler exists to prevent.
    expect(mocks.listSpeakerTagMembership).toHaveBeenCalledTimes(1)
  })

  it('filters on a tag name, which is the half of the feature the read exists for', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace'),
      speaker('spk2', 'Hopper'),
    ])
    mocks.listSpeakerTags.mockResolvedValue([KEYNOTE, ALUMNI])
    mocks.listSpeakerTagMembership.mockResolvedValue(
      new Map([
        ['spk1', ['tag1']],
        ['spk2', ['tag2']],
      ]),
    )

    const view = await loadCrmDirectory(scope, {
      ...QUERY,
      filters: [{ id: 'f0', key: 'tags', operator: 'contains', value: 'keynote' }],
    })

    expect(view.rows.map((row) => row.speaker.id)).toEqual(['spk1'])
  })

  it('matches an untagged speaker on is_empty, and only that speaker', async () => {
    mocks.listSpeakersInEvents.mockResolvedValue([
      speaker('spk1', 'Lovelace'),
      speaker('spk2', 'Hopper'),
    ])
    mocks.listSpeakerTags.mockResolvedValue([KEYNOTE])
    mocks.listSpeakerTagMembership.mockResolvedValue(new Map([['spk1', ['tag1']]]))

    const view = await loadCrmDirectory(scope, {
      ...QUERY,
      filters: [{ id: 'f0', key: 'tags', operator: 'is_empty', value: '' }],
    })

    expect(view.rows.map((row) => row.speaker.id)).toEqual(['spk2'])
  })

  it('reads nothing per event when the viewer belongs to none', async () => {
    // `requireCrmScope` refuses that case before this function is reached, so this is a
    // guard against a future caller, not a live path. It must not fan out over an empty
    // set and must not throw.
    mocks.listSpeakersInEvents.mockResolvedValue([])
    const view = await loadCrmDirectory({ ...scope, eventIds: [] }, QUERY)

    expect(view).toMatchObject({ rows: [], totalRows: 0, page: 1, speakerCount: 0, eventCount: 0 })
    expect(mocks.listSubmissions).not.toHaveBeenCalled()
  })
})

describe('creatableEvents', () => {
  // What the Add Contact dialog offers. Creating a contact links them to an event, so it is a
  // write, and an empty list is what leaves the control off the header for a reviewer.
  beforeEach(() => {
    mocks.listSpeakersInEvents.mockResolvedValue([])
  })

  it('names every event the viewer holds admin over', async () => {
    const view = await loadCrmDirectory(scope, QUERY)
    expect(view.creatableEvents).toEqual([
      { id: 'e1', name: 'Event e1' },
      { id: 'e2', name: 'Event e2' },
    ])
  })

  it('offers nothing to a reviewer, whatever they can read', async () => {
    const view = await loadCrmDirectory({ ...scope, adminEventIds: [] }, QUERY)
    expect(view.creatableEvents).toEqual([])
    expect(mocks.getEvent).not.toHaveBeenCalled()
  })

  it('drops an event whose record cannot be read rather than failing the page', async () => {
    mocks.getEvent.mockImplementation((eventId: string) =>
      eventId === 'e1'
        ? Promise.resolve({ id: eventId, name: 'Event e1' })
        : Promise.reject(new Error('gone')),
    )
    const view = await loadCrmDirectory(scope, QUERY)
    expect(view.creatableEvents).toEqual([{ id: 'e1', name: 'Event e1' }])
  })
})
