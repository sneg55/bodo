// Who may write a portal, and the exactly-one-default invariant. BUILD_SPEC 5.0c.
// Duplicate and reorder are tests/portal-config-duplicate.test.ts; `savePortalItems` is
// tests/portal-config-items.test.ts, because it answers an entirely different rule.
//
// The assertions that matter are mostly NOT "it throws". They are that nothing was written,
// and that the write that did happen carried the value the STORED row held rather than the
// one the payload asserted. A guard that runs after the write is decoration, and an invariant
// enforced from the payload is not enforced at all.
//
// The invariant is invisible on the admin screen, where an event with two default portals and
// an event with one render identically, and it surfaces only as a speaker in the wrong
// portal: `matchPortal` answers `undefined` with no default and picks by record id with two.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

import { CUSTOM, EVENT, FALLBACK, portal, TRACK_FILTER } from './helpers/portal-config-fakes'

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  listPortalsUncached: vi.fn(),
  getPortal: vi.fn(),
  listPortalItemsUncached: vi.fn(),
  createPortal: vi.fn(),
  updatePortal: vi.fn(() => Promise.resolve()),
  deletePortal: vi.fn(() => Promise.resolve()),
  reorderPortals: vi.fn(() => Promise.resolve()),
  writePortalItems: vi.fn(() => Promise.resolve()),
  noop: vi.fn(() => Promise.resolve([] as unknown[])),
}))

vi.mock('@/features/auth/wiring', () => ({ requireEventRole: mocks.requireEventRole }))
vi.mock('@/services/airtable/reads-portals', () => ({
  listPortalsUncached: mocks.listPortalsUncached,
  getPortal: mocks.getPortal,
}))
vi.mock('@/services/airtable/reads-resources', () => ({
  listPortalItemsUncached: mocks.listPortalItemsUncached,
}))
vi.mock('@/services/airtable/mutations-portals', () => ({
  createPortal: mocks.createPortal,
  updatePortal: mocks.updatePortal,
  deletePortal: mocks.deletePortal,
  reorderPortals: mocks.reorderPortals,
}))
vi.mock('@/services/airtable/mutations-portal-items', () => ({
  writePortalItems: mocks.writePortalItems,
}))
vi.mock('@/services/airtable/queries', () => ({
  listTasksForEvent: mocks.noop,
  listForms: mocks.noop,
  listFileRequests: mocks.noop,
  listResources: mocks.noop,
}))

const { deletePortalAction, savePortalAction } = await import('@/features/portal-config/actions')

const SAVE = {
  eventId: EVENT,
  name: 'Moderators',
  filters: TRACK_FILTER,
  alwaysShowTasks: false,
  manageProfile: false,
}

/** Every write mock, so "nothing was written" is one assertion rather than five. */
function expectNoWrites() {
  for (const write of [
    mocks.createPortal,
    mocks.updatePortal,
    mocks.deletePortal,
    mocks.reorderPortals,
    mocks.writePortalItems,
  ]) {
    expect(write).not.toHaveBeenCalled()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ userId: 'recUser1', role: 'admin' })
  mocks.listPortalsUncached.mockResolvedValue([FALLBACK, CUSTOM])
  mocks.listPortalItemsUncached.mockResolvedValue([])
  mocks.createPortal.mockImplementation((draft: { name: string }) =>
    Promise.resolve({ id: 'recPortalNew', ...draft }),
  )
})

describe('authorization', () => {
  it('refuses a caller without admin on the event, and writes and reads nothing', async () => {
    mocks.requireEventRole.mockRejectedValue(new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'nope', {}))

    expect(await savePortalAction(SAVE)).toEqual({ ok: false, error: 'nope' })
    // Refused before it read anything, which is what "authorize first" means.
    expect(mocks.listPortalsUncached).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('asks for `admin` on the event named in the payload, never a weaker role', async () => {
    await savePortalAction(SAVE)

    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT, 'admin')
  })

  it('refuses a portal id belonging to another event before it writes', async () => {
    // Holding admin on this event is not permission to point its actions at another
    // conference's record ids.
    expect((await savePortalAction({ ...SAVE, portalId: 'recSomeoneElses' })).ok).toBe(false)
    expectNoWrites()
  })
})

describe('savePortalAction and the exactly-one-default invariant', () => {
  it('decides the write from the UNCACHED list, never from a cached one', async () => {
    await savePortalAction(SAVE)

    expect(mocks.listPortalsUncached).toHaveBeenCalledWith(EVENT)
  })

  it('refuses every save while the event carries no default portal', async () => {
    mocks.listPortalsUncached.mockResolvedValue([CUSTOM])

    expect((await savePortalAction(SAVE)).ok).toBe(false)
    expectNoWrites()
  })

  it('refuses every save while the event carries two defaults', async () => {
    mocks.listPortalsUncached.mockResolvedValue([
      FALLBACK,
      portal({ id: 'recTwo', isDefault: true }),
    ])

    expect((await savePortalAction(SAVE)).ok).toBe(false)
    expectNoWrites()
  })

  it('creates a portal as non-default and last in the order', async () => {
    expect(await savePortalAction(SAVE)).toEqual({ ok: true, portalId: 'recPortalNew' })
    expect(mocks.createPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        isDefault: false,
        order: 2,
        kind: 'contacts',
        name: 'Moderators',
      }),
    )
  })

  it('refuses a blank name rather than creating a row nothing can identify', async () => {
    expect(await savePortalAction({ ...SAVE, name: '   ' })).toEqual({
      ok: false,
      error: 'Give the portal a name.',
    })
    expectNoWrites()
  })

  it('keeps `isDefault` and `order` from the stored row on an edit', async () => {
    await savePortalAction({ ...SAVE, portalId: CUSTOM.id, name: 'Chairs' })

    expect(mocks.updatePortal).toHaveBeenCalledWith(
      expect.objectContaining({
        portalId: CUSTOM.id,
        eventId: EVENT,
        update: expect.objectContaining({ name: 'Chairs', isDefault: false, order: 1 }),
      }),
    )
  })

  it('pins the default portal back to order 0 and strips filters posted onto it', async () => {
    // The default is the "everyone else" bucket: `firstMatch` skips its filters, so storing
    // them would show an organizer a rule that provably does nothing.
    await savePortalAction({ ...SAVE, portalId: FALLBACK.id, name: 'Speakers' })

    expect(mocks.updatePortal).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isDefault: true,
          order: 0,
          filters: EMPTY_PORTAL_FILTERS,
        }),
      }),
    )
  })
})

describe('deletePortalAction', () => {
  it('deletes a custom portal after checking the record belongs to the event', async () => {
    mocks.getPortal.mockResolvedValue(CUSTOM)

    expect(await deletePortalAction({ eventId: EVENT, portalId: CUSTOM.id })).toEqual({
      ok: true,
      portalId: CUSTOM.id,
    })
    expect(mocks.deletePortal).toHaveBeenCalledWith({ portalId: CUSTOM.id, eventId: EVENT })
  })

  it('refuses the default portal in the ACTION, not only in the mutation', async () => {
    // Deleting it does not remove a portal, it removes the floor: contacts matching no filter
    // then have nowhere to land. Two guards on purpose, since the action is the security
    // boundary and the mutation is the last place that can still see the record.
    mocks.getPortal.mockResolvedValue(FALLBACK)

    expect(await deletePortalAction({ eventId: EVENT, portalId: FALLBACK.id })).toEqual({
      ok: false,
      error: 'The default portal cannot be deleted.',
    })
    expect(mocks.deletePortal).not.toHaveBeenCalled()
  })

  it('refuses a record from another event', async () => {
    mocks.getPortal.mockResolvedValue(portal({ id: 'recOther', eventId: 'recEvent2' }))

    expect((await deletePortalAction({ eventId: EVENT, portalId: 'recOther' })).ok).toBe(false)
    expect(mocks.deletePortal).not.toHaveBeenCalled()
  })
})
