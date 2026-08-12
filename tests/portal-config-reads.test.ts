// The two portal admin reads, with the DAL mocked. BUILD_SPEC 5.0c.
//
// The subject is COMPOSITION, not the matching rules: those are tests/portal-match.test.ts
// and tests/portal-contacts.test.ts, and repeating them here would only pin a second copy of
// them. What is asserted here is the part only the composed read can get wrong:
//
//   1. The matched count is the FIRST-MATCH-WINS number, so a contact claimed by an earlier
//      portal is not counted twice. A count that double-counted would tell an organizer their
//      new filter is working when it is shadowed.
//   2. Every portal gets a count, zeros included. A filter matching nobody is the failure
//      mode of this whole feature and the zero is the only place it is visible.
//   3. The count costs a fixed number of reads whatever the portal count is. A per-portal
//      query would fan out against a 5 req/s base AND would be wrong, since it cannot see who
//      the portals above already claimed.
//   4. The preview deliberately does NOT apply first match wins, because it answers a
//      different question from the count.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_PORTAL_FILTERS, type Portal, type PortalFilters } from '@/types/portals'

const EVENT = 'recEvent1'
const OTHER_EVENT = 'recEvent2'

const mocks = vi.hoisted(() => ({
  listPortals: vi.fn(),
  listSpeakers: vi.fn(),
  listSubmissions: vi.fn(),
  listTasksForEvent: vi.fn(() => Promise.resolve([] as unknown[])),
  listForms: vi.fn(() => Promise.resolve([] as unknown[])),
  listFileRequests: vi.fn(() => Promise.resolve([] as unknown[])),
  listResources: vi.fn(() => Promise.resolve([] as unknown[])),
  listPortalItems: vi.fn(() => Promise.resolve([] as unknown[])),
}))

vi.mock('@/services/airtable/queries', () => mocks)

const { readPortalEditor, readPortalList, readPortalMatchPreview } = await import(
  '@/features/portal-config/reads'
)

function portal(over: Partial<Portal> & { id: string }): Portal {
  return {
    eventId: EVENT,
    name: 'Portal',
    kind: 'contacts',
    isDefault: false,
    order: 1,
    filters: EMPTY_PORTAL_FILTERS,
    alwaysShowTasks: false,
    manageProfile: false,
    ...over,
  }
}

const DEFAULT_PORTAL = portal({ id: 'recPortalDefault', isDefault: true, order: 0 })

function filters(over: Partial<PortalFilters>): PortalFilters {
  return { ...EMPTY_PORTAL_FILTERS, ...over }
}

/** A speaker with a company, which is the one contact field a rule can test directly. */
function speaker(id: string, company?: string) {
  return { id, firstName: 'A', lastName: id, email: `${id}@example.com`, company }
}

/** A submission carrying its cast inline, which is what `listSubmissions` hands back. */
function submission(id: string, speakerIds: readonly string[], over: Record<string, unknown> = {}) {
  return {
    id,
    eventId: EVENT,
    submitterId: speakerIds[0],
    title: id,
    tagIds: [],
    participants: speakerIds.map((speakerId) => ({
      id: `${id}-${speakerId}`,
      submissionId: id,
      speakerId,
      role: 'speaker',
      isPrimary: true,
      sortOrder: 0,
    })),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listSpeakers.mockResolvedValue([
    speaker('recAna', 'Acme'),
    speaker('recBo', 'Acme'),
    speaker('recCy', 'Globex'),
  ])
  mocks.listSubmissions.mockResolvedValue([
    submission('recSub1', ['recAna'], { trackId: 'recTrackPlatform' }),
    submission('recSub2', ['recBo'], { trackId: 'recTrackSecurity' }),
    submission('recSub3', ['recCy'], { trackId: 'recTrackSecurity' }),
  ])
})

describe('readPortalList', () => {
  it('counts every contact exactly once, under the first portal that claims them', async () => {
    // Acme is a superset of the platform track: Ana qualifies for both. First match wins, so
    // she belongs to the platform portal and must NOT also be counted under Acme.
    mocks.listPortals.mockResolvedValue([
      DEFAULT_PORTAL,
      portal({
        id: 'recPlatform',
        order: 1,
        filters: filters({
          rules: [{ field: 'track', operator: 'is', values: ['recTrackPlatform'] }],
        }),
      }),
      portal({
        id: 'recAcme',
        order: 2,
        filters: filters({ rules: [{ field: 'company', operator: 'is', values: ['Acme'] }] }),
      }),
    ])

    const rows = await readPortalList(EVENT)

    expect(rows.map((row) => [row.portal.id, row.matchedCount])).toEqual([
      // Cy matches neither custom portal and falls back here.
      ['recPortalDefault', 1],
      ['recPlatform', 1],
      // Bo only. Ana was already claimed above.
      ['recAcme', 1],
    ])
  })

  it('renders a zero rather than omitting a portal that matches nobody', async () => {
    mocks.listPortals.mockResolvedValue([
      DEFAULT_PORTAL,
      portal({
        id: 'recNobody',
        order: 1,
        filters: filters({ rules: [{ field: 'company', operator: 'is', values: ['Initech'] }] }),
      }),
    ])

    const rows = await readPortalList(EVENT)

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.portal.id === 'recNobody')?.matchedCount).toBe(0)
    expect(rows.find((row) => row.portal.id === 'recPortalDefault')?.matchedCount).toBe(3)
  })

  it('costs one pass over the event however many portals there are', async () => {
    mocks.listPortals.mockResolvedValue([
      DEFAULT_PORTAL,
      portal({ id: 'recP1', order: 1 }),
      portal({ id: 'recP2', order: 2 }),
      portal({ id: 'recP3', order: 3 }),
    ])

    await readPortalList(EVENT)

    // Three reads for four portals, and the same three for forty.
    expect(mocks.listPortals).toHaveBeenCalledTimes(1)
    expect(mocks.listSpeakers).toHaveBeenCalledTimes(1)
    expect(mocks.listSubmissions).toHaveBeenCalledTimes(1)
  })

  it('keeps the order the DAL sorted on, because that is the order the matcher walks', async () => {
    mocks.listPortals.mockResolvedValue([
      DEFAULT_PORTAL,
      portal({ id: 'recSecond', order: 1 }),
      portal({ id: 'recThird', order: 2 }),
    ])

    expect((await readPortalList(EVENT)).map((row) => row.portal.id)).toEqual([
      'recPortalDefault',
      'recSecond',
      'recThird',
    ])
  })
})

describe('readPortalEditor', () => {
  it('is undefined for a portal id belonging to another event, so the page can 404', async () => {
    mocks.listPortals.mockResolvedValue([DEFAULT_PORTAL, portal({ id: 'recElsewhere' })])

    expect(await readPortalEditor(EVENT, 'recNoSuchPortal')).toBeUndefined()
  })

  it('does not accept a row whose own event link points somewhere else', async () => {
    // Both sides of the join carry an event and only one of them is filtered by the read.
    mocks.listPortals.mockResolvedValue([
      portal({ id: 'recForeign', eventId: OTHER_EVENT, isDefault: true, order: 0 }),
    ])

    expect(await readPortalEditor(EVENT, 'recForeign')).toBeUndefined()
  })

  it('builds the four cards, and only reads the sources once it has a portal', async () => {
    mocks.listPortals.mockResolvedValue([DEFAULT_PORTAL])
    mocks.listTasksForEvent.mockResolvedValue([{ id: 'recTask1', eventId: EVENT, title: 'Bio' }])

    const editor = await readPortalEditor(EVENT, DEFAULT_PORTAL.id)

    expect(editor?.portal.id).toBe(DEFAULT_PORTAL.id)
    expect(editor?.content.task.map((row) => row.itemId)).toEqual(['recTask1'])
    // No row for the task, and no row means SHOWN for that kind.
    expect(editor?.content.task.at(0)?.enabled).toBe(true)
    expect(editor?.content.resource).toEqual([])
  })

  it('reads nothing beyond the portal list when the id does not resolve', async () => {
    mocks.listPortals.mockResolvedValue([DEFAULT_PORTAL])

    await readPortalEditor(EVENT, 'recNoSuchPortal')

    expect(mocks.listTasksForEvent).not.toHaveBeenCalled()
    expect(mocks.listPortalItems).not.toHaveBeenCalled()
  })
})

describe('readPortalMatchPreview', () => {
  it('lists everybody the filter describes, ignoring who other portals already claimed', async () => {
    // The list screen would count Ana under an earlier portal. The wizard is asking a
    // different question: does this rule describe anybody at all? Subtracting the contacts an
    // unrelated portal claimed would preview a good filter as smaller than it is.
    const matched = await readPortalMatchPreview(
      EVENT,
      filters({ rules: [{ field: 'company', operator: 'is', values: ['Acme'] }] }),
    )

    expect(matched.map((contact) => contact.speakerId)).toEqual(['recAna', 'recBo'])
    expect(mocks.listPortals).not.toHaveBeenCalled()
  })

  it('answers empty for a filter that matches nobody, which is what the review step shows', async () => {
    const matched = await readPortalMatchPreview(
      EVENT,
      filters({ rules: [{ field: 'company', operator: 'is', values: ['Initech'] }] }),
    )

    expect(matched).toEqual([])
  })

  it('returns the contacts themselves, so the review step can list who matched', async () => {
    const matched = await readPortalMatchPreview(
      EVENT,
      filters({ rules: [{ field: 'track', operator: 'is', values: ['recTrackSecurity'] }] }),
    )

    expect(matched.map((contact) => contact.speakerId)).toEqual(['recBo', 'recCy'])
    expect(matched.at(0)?.sessions.map((session) => session.submissionId)).toEqual(['recSub2'])
  })
})
