// Duplicating a portal, and reordering the list. BUILD_SPEC 5.0c.
//
// Two writes with one thing in common: both are about the ORDER, which on this table is not
// cosmetic. Assignment is first match wins, so a copy inserted above the portals an organizer
// already tuned silently takes contacts off them, and two portals sharing a number make a
// contact's portal depend on the sequence Airtable happened to paginate them in.
//
// The other half is the content copy. A duplicate carrying the filters but not the
// PortalItems rows is a portal that matches exactly the right audience and exposes nothing to
// them, which reads on every admin screen as a working portal.
//
// Authorization and the exactly-one-default invariant are tests/portal-config-actions.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CUSTOM, EVENT, FALLBACK, item, portal, TRACK_FILTER } from './helpers/portal-config-fakes'

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

const { duplicatePortalAction, reorderPortalsAction } = await import(
  '@/features/portal-config/actions'
)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ userId: 'recUser1', role: 'admin' })
  mocks.listPortalsUncached.mockResolvedValue([FALLBACK, CUSTOM])
  mocks.listPortalItemsUncached.mockResolvedValue([])
  mocks.createPortal.mockImplementation((draft: { name: string }) =>
    Promise.resolve({ id: 'recPortalNew', ...draft }),
  )
})

describe('duplicatePortalAction', () => {
  it('copies the filters and the settings under a name no other portal holds', async () => {
    mocks.listPortalsUncached.mockResolvedValue([
      FALLBACK,
      portal({ id: CUSTOM.id, name: 'Moderators', filters: TRACK_FILTER, manageProfile: true }),
      portal({ id: 'recCopy1', name: 'Moderators Copy', order: 2 }),
    ])

    await duplicatePortalAction({ eventId: EVENT, portalId: CUSTOM.id })

    expect(mocks.createPortal).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Moderators Copy 2',
        isDefault: false,
        order: 3,
        filters: TRACK_FILTER,
        manageProfile: true,
      }),
    )
  })

  it('copies the source portal CONTENT, and only the rows that portal owns', async () => {
    mocks.listPortalItemsUncached.mockResolvedValue([
      item({ id: 'recPi1', taskId: 'recTask1', portalId: CUSTOM.id, order: 0 }),
      item({
        id: 'recPi2',
        itemType: 'resource',
        resourceId: 'recRes1',
        portalId: CUSTOM.id,
        enabled: false,
        order: 1,
      }),
      // Another portal's row, and a pre-5.0c row with no link, which belongs to the DEFAULT
      // portal. Neither is the source's, so neither may ride along.
      item({ id: 'recPi3', taskId: 'recTask2', portalId: 'recElsewhere' }),
      item({ id: 'recPi4', taskId: 'recTask3' }),
    ])

    await duplicatePortalAction({ eventId: EVENT, portalId: CUSTOM.id })

    expect(mocks.writePortalItems).toHaveBeenCalledWith({
      eventId: EVENT,
      portalId: 'recPortalNew',
      patches: [],
      creates: [
        { itemType: 'task', itemId: 'recTask1', enabled: true, order: 0 },
        { itemType: 'resource', itemId: 'recRes1', enabled: false, order: 1 },
      ],
    })
  })

  it('gives a copy of the DEFAULT its legacy rows, and makes the copy non-default', async () => {
    mocks.listPortalItemsUncached.mockResolvedValue([
      item({ id: 'recPi4', taskId: 'recTask3' }),
      item({ id: 'recPi3', taskId: 'recTask2', portalId: CUSTOM.id }),
    ])

    await duplicatePortalAction({ eventId: EVENT, portalId: FALLBACK.id })

    expect(mocks.createPortal).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: false, name: 'Speaker Portal Copy' }),
    )
    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        creates: [{ itemType: 'task', itemId: 'recTask3', enabled: true, order: 0 }],
      }),
    )
  })

  it('names the new record when the content copy fails, so the half-copy is findable', async () => {
    mocks.writePortalItems.mockRejectedValue(new Error('429'))

    const result = await duplicatePortalAction({ eventId: EVENT, portalId: CUSTOM.id })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('recPortalNew')
  })

  it('refuses a portal id from another event, and creates nothing', async () => {
    expect((await duplicatePortalAction({ eventId: EVENT, portalId: 'recForeign' })).ok).toBe(false)
    expect(mocks.createPortal).not.toHaveBeenCalled()
  })
})

describe('reorderPortalsAction', () => {
  const THIRD = portal({ id: 'recThird', order: 2 })

  beforeEach(() => {
    mocks.listPortalsUncached.mockResolvedValue([FALLBACK, CUSTOM, THIRD])
  })

  it('pins the default first however the client dragged it', async () => {
    // Safe precisely because `matchPortal` never treats the default as a candidate: it is
    // fallen back to, not matched, so a fallback at position 0 does not swallow the event.
    // A drag past a pinned row is a UI mistake, so it is corrected rather than rejected.
    await reorderPortalsAction({ eventId: EVENT, portalIds: [THIRD.id, FALLBACK.id, CUSTOM.id] })

    expect(mocks.reorderPortals).toHaveBeenCalledWith({
      eventId: EVENT,
      portalIds: [FALLBACK.id, THIRD.id, CUSTOM.id],
    })
  })

  it('appends portals the payload left out, so no two rows can share a number', async () => {
    await reorderPortalsAction({ eventId: EVENT, portalIds: [THIRD.id] })

    expect(mocks.reorderPortals).toHaveBeenCalledWith({
      eventId: EVENT,
      portalIds: [FALLBACK.id, THIRD.id, CUSTOM.id],
    })
  })

  it('keeps the first position of a repeated id rather than letting the last patch win', async () => {
    await reorderPortalsAction({ eventId: EVENT, portalIds: [CUSTOM.id, THIRD.id, CUSTOM.id] })

    expect(mocks.reorderPortals).toHaveBeenCalledWith({
      eventId: EVENT,
      portalIds: [FALLBACK.id, CUSTOM.id, THIRD.id],
    })
  })

  it('refuses the whole request when an id is not a portal on this event', async () => {
    // Skipping it would write a plausible-looking order off a payload that was already
    // describing another conference.
    const result = await reorderPortalsAction({
      eventId: EVENT,
      portalIds: [CUSTOM.id, 'recForeign'],
    })

    expect(result.ok).toBe(false)
    expect(mocks.reorderPortals).not.toHaveBeenCalled()
  })
})
