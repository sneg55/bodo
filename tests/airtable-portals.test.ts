// Portals, mapped from Airtable's own shape, built back into it, and read with the cache
// each read is supposed to declare. BUILD_SPEC 5.0c.
//
// Written by hand in wire shape rather than round-tripped through the field builders, for
// the same reason tests/airtable-resources.test.ts is: a round trip agrees with itself even
// when both halves are wrong.
//
// What earns a case is narrow, because every fact this table stores is invisible from the
// admin side once it is wrong: a portal is never rendered to whoever configured it, the
// matcher walks the list in `order` and takes the first match, and the wrong answer still
// looks like a correct list. So: the defaults that decide which way a wrong read pushes a
// contact, the one required column, the blob that must degrade instead of throwing, and the
// cache split that keeps a WRITE out of a cached list.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { mapPortal } from '@/services/airtable/mapping-portals'
import { REVALIDATE } from '@/services/airtable/read-cache'
import type { AirtableRecord } from '@/services/airtable/records'
import {
  portalFields,
  portalOrderFields,
  portalUpdateFields,
} from '@/services/airtable/to-fields-portals'
import { portalItemFields, portalItemUpdateFields } from '@/services/airtable/to-fields-resources'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(fn: () => unknown): string {
  try {
    fn()
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
}

const PORTAL_CORE = { name: 'Keynote speakers', event: ['recEvent1'] }

const FILTERS = {
  contactTypes: ['speaker', 'moderator'],
  rules: [{ field: 'track', operator: 'is_not', values: ['recTrk1', 'recTrk2'] }],
}

const EDIT = {
  name: 'Keynote speakers',
  kind: 'contacts',
  isDefault: false,
  order: 0,
  filters: EMPTY_PORTAL_FILTERS,
  alwaysShowTasks: false,
  manageProfile: false,
} as const

describe('mapPortal', () => {
  it('collapses the event link and reads the whole row', () => {
    expect(
      mapPortal(
        record('recPortal1', {
          ...PORTAL_CORE,
          kind: 'contacts',
          isDefault: true,
          order: 3,
          filterJson: JSON.stringify(FILTERS),
          welcomeMessage: 'Thanks for speaking.',
          alwaysShowTasks: true,
          manageProfile: true,
        }),
      ),
    ).toEqual({
      id: 'recPortal1',
      eventId: 'recEvent1',
      name: 'Keynote speakers',
      kind: 'contacts',
      isDefault: true,
      order: 3,
      filters: FILTERS,
      welcomeMessage: 'Thanks for speaking.',
      alwaysShowTasks: true,
      manageProfile: true,
    })
  })

  it('refuses a row with no name or no event link', () => {
    // No slug, no code and no public URL carries a portal's name, so a nameless row is a
    // line an organizer cannot tell from the one above it while dragging the order.
    expect(errorId(() => mapPortal(record('recPortal1', { event: ['recEvent1'] })))).toBe(
      'E_DATA_002',
    )
    expect(errorId(() => mapPortal(record('recPortal1', { name: 'Orphan' })))).toBe('E_DATA_002')
  })

  it('reads every blank column as the answer that is safe to be wrong about', () => {
    const portal = mapPortal(record('recPortal1', PORTAL_CORE))

    // The groups module is waived, so an empty select is an unfinished CONTACTS portal. The
    // other reading hides the row from every contacts query with nothing on screen saying so.
    expect(portal.kind).toBe('contacts')

    // 0 sorts the row first rather than dropping it: wrong, visible, and one drag from
    // right, where sorting it last would hide a portal whose filters still claim contacts.
    expect(portal.order).toBe(0)
    // Not default, so a row that lost its box leaves the event with none rather than handing
    // every unmatched contact to a portal only accidentally marked default. The two settings
    // are additive permissions, so false shows a speaker less than intended, not more.
    expect(portal.isDefault).toBe(false)
    expect(portal.alwaysShowTasks).toBe(false)
    expect(portal.manageProfile).toBe(false)
    expect(portal.welcomeMessage).toBeUndefined()
    expect(portal.filters).toEqual(EMPTY_PORTAL_FILTERS)
  })

  it('falls back to no filters on a blob of the wrong shape rather than throwing', () => {
    // A read that failed here would take down the portals list, the editor that is the only
    // place the blob can be repaired, and the assignment read that decides where every
    // contact lands. Losing the predicates costs the portal its claim on anybody, and
    // everyone it stops claiming falls through to the default portal.
    expect(
      mapPortal(record('recP1', { ...PORTAL_CORE, filterJson: '{"rules":"all"}' })).filters,
    ).toEqual(EMPTY_PORTAL_FILTERS)
  })

  it('drops the whole rule set rather than the one rule it could not read', () => {
    // Per-rule salvage would WIDEN membership whenever the unreadable rule is an `is_not`, and
    // a portal that quietly gained people is the failure nobody sees. Dropping the set narrows.
    const blob = JSON.stringify({
      contactTypes: ['speaker'],
      rules: [
        { field: 'track', operator: 'is_not', values: ['recTrk1'] },
        { field: 'sponsorTier', operator: 'is', values: ['gold'] },
      ],
    })

    expect(mapPortal(record('recP1', { ...PORTAL_CORE, filterJson: blob })).filters).toEqual(
      EMPTY_PORTAL_FILTERS,
    )
  })

  it('still throws on text that is not JSON at all', () => {
    // The boundary is `jsonBlob`'s, not this schema's: unparseable means a corrupt WRITE,
    // since the app only ever stores `JSON.stringify` output, while a shape mismatch is an
    // older blob or one typed by hand.
    expect(errorId(() => mapPortal(record('recP1', { ...PORTAL_CORE, filterJson: 'all' })))).toBe(
      'E_DATA_002',
    )
  })
})

describe('the Portals field builders', () => {
  it('sends the event as a link array, stringifies the filters, omits what is absent', () => {
    expect(portalFields({ ...EDIT, eventId: 'recEvent1', order: 2 })).toEqual({
      name: 'Keynote speakers',
      event: ['recEvent1'],
      kind: 'contacts',
      isDefault: false,
      order: 2,
      filterJson: '{"contactTypes":[],"rules":[]}',
      alwaysShowTasks: false,
      manageProfile: false,
    })
  })

  it('always writes filterJson on an update, so cleared predicates stop matching', () => {
    // An omitted key would leave the old predicates in the column, still claiming contacts,
    // while the editor showed an empty rule list.
    const fields = portalUpdateFields(EDIT)

    expect(fields.filterJson).toBe('{"contactTypes":[],"rules":[]}')
    // Cleared, not left: last month's welcome text must not keep rendering above a speaker's
    // task list. `isDefault` is present even when false, because moving the default is two
    // writes and the losing row's write is nothing but this key.
    expect(fields.welcomeMessage).toBeNull()
    expect(fields.isDefault).toBe(false)
    // Never re-sent, so a mis-passed event id cannot move a portal to another conference.
    expect(Object.keys(fields)).not.toContain('event')
  })

  it('writes the position and nothing else on a reorder', () => {
    // A drag that round-tripped the filters would revert a rule edit made in another tab.
    expect(portalOrderFields(4)).toEqual({ order: 4 })
  })
})

describe('the PortalItems portal link', () => {
  it('sends the portal as a link array on a create', () => {
    expect(
      portalItemFields({
        eventId: 'recEvent1',
        portalId: 'recPortal1',
        itemType: 'resource',
        resourceId: 'recRes1',
        enabled: true,
        order: 0,
      }),
    ).toEqual({
      order: 0,
      event: ['recEvent1'],
      portal: ['recPortal1'],
      itemType: 'resource',
      resource: ['recRes1'],
      enabled: true,
    })
  })

  it('omits the link when no portal was named, and sets it only for the backfill', () => {
    // An absent link reads as the event's default portal, and `[]` would be a write saying the
    // same thing. Omitting keeps a publication save from re-assigning a row it never asked
    // about; only the backfill for a pre-5.0c row passes an id.
    const create = portalItemFields({
      eventId: 'recEvent1',
      itemType: 'resource',
      resourceId: 'recRes1',
      enabled: true,
      order: 0,
    })

    expect(Object.keys(create)).not.toContain('portal')
    expect(Object.keys(portalItemUpdateFields({ enabled: true, order: 1 }))).not.toContain('portal')
    expect(portalItemUpdateFields({ enabled: false, order: 2, portalId: 'recPortal1' })).toEqual({
      enabled: false,
      order: 2,
      portal: ['recPortal1'],
    })
  })
})

// ── The reads, through a stubbed global fetch ────────────────────────────────

const ORIGINAL_ENV = { ...process.env }

/**
 * Load the live reads with credentials configured and `fetch` captured. Credentials matter:
 * with none, `getSource()` serves fixtures and issues no request, so a test that skipped this
 * asserts nothing at all. The pattern is tests/airtable-read-cache.test.ts's.
 */
async function loadReads(): Promise<{
  calls: { url: string; init: RequestInit }[]
  portals: typeof import('@/services/airtable/reads-portals')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    const body = url.includes('/Portals/rec')
      ? { id: 'recPortal1', fields: PORTAL_CORE }
      : { records: [] }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return { calls, portals: await import('@/services/airtable/reads-portals') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('the portals reads declare the cache each of them is entitled to', () => {
  it('gives the list the same tag the resource and item reads already carry', async () => {
    const { portals, calls } = await loadReads()

    await portals.listPortals('recE1')

    // `eventPortalsTag` is `eventResourcesTag` under another name. A tag of its own would let
    // the order expire while the item rows still served the answer they had before the drag,
    // and first match wins, so a stale order is a contact in the wrong portal.
    expect(calls.at(0)?.init.next).toEqual({
      revalidate: REVALIDATE.edited,
      tags: ['event:recE1:resources'],
    })
  })

  it('leaves both reads a write is decided from uncached', async () => {
    const { portals, calls } = await loadReads()

    // `savePortal` picks create-versus-update and enforces exactly-one-default from the list;
    // `deletePortal` refuses on the `isDefault` box the single read returns. Cached, the first
    // gives an event two defaults and the second deletes a portal that just became default.
    await portals.listPortalsUncached('recE1')
    await portals.getPortal('recPortal1')

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.init.cache).toBe('no-store')
      expect(call.init.next).toBeUndefined()
    }
  })
})
