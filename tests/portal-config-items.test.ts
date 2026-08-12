// `savePortalItems`: the exposure gate, and the rule that it is never an assignment.
// BUILD_SPEC 5.0c.
//
// **The rule.** PortalItems decides what a portal SHOWS and in what order. Who owes what is
// `TaskAssignments` and `FileRequestAssignments`, fanned out at accept time. So an enabled row
// shows a speaker only what they are already assigned, a disabled row hides the surface from
// everybody, and nothing this action writes may be read as evidence of an assignment.
//
// **The rule that decides how much it writes**: "a row is written only when an organizer
// touches the control". Every event in the base has assignments and ZERO PortalItems rows for
// tasks, forms and file requests, and absence means SHOWN for those three kinds, so a save
// that changes nothing must write nothing or the base gains a permanent row per surface per
// portal that nobody asked for. A DRAG is a touch too, which is the second half of the rule
// and the one that shipped missing: see the reorder tests below.
//
// Ordering is dense from 0 on every save: a tie makes the nav depend on pagination order.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PortalItemRow } from '@/features/portal-config/items'

import { CUSTOM, EVENT, FALLBACK, item } from './helpers/portal-config-fakes'

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
  listTasksForEvent: vi.fn(() => Promise.resolve([] as unknown[])),
  listForms: vi.fn(() => Promise.resolve([] as unknown[])),
  listFileRequests: vi.fn(() => Promise.resolve([] as unknown[])),
  listResources: vi.fn(() => Promise.resolve([] as unknown[])),
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
  listTasksForEvent: mocks.listTasksForEvent,
  listForms: mocks.listForms,
  listFileRequests: mocks.listFileRequests,
  listResources: mocks.listResources,
}))

const { savePortalItemsAction } = await import('@/features/portal-config/actions')

const TASKS = [
  { id: 'recTask1', eventId: EVENT, title: 'Headshot' },
  { id: 'recTask2', eventId: EVENT, title: 'Bio' },
]

function row(over: Partial<PortalItemRow> & { itemId: string }): PortalItemRow {
  return { itemType: 'task', enabled: true, order: 0, ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireEventRole.mockResolvedValue({ userId: 'recUser1', role: 'admin' })
  mocks.getPortal.mockResolvedValue(CUSTOM)
  mocks.listPortalItemsUncached.mockResolvedValue([])
  mocks.listTasksForEvent.mockResolvedValue(TASKS)
})

describe('authorization and scope', () => {
  it('asks for admin on the event, and refuses a portal belonging to another one', async () => {
    mocks.getPortal.mockResolvedValue({ ...CUSTOM, eventId: 'recEvent2' })

    expect(
      (await savePortalItemsAction({ eventId: EVENT, portalId: CUSTOM.id, rows: [] })).ok,
    ).toBe(false)
    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT, 'admin')
    expect(mocks.writePortalItems).not.toHaveBeenCalled()
  })

  it('diffs against the UNCACHED PortalItems rows, never the cached list', async () => {
    await savePortalItemsAction({ eventId: EVENT, portalId: CUSTOM.id, rows: [] })

    // A cached answer creates a duplicate row on the second save, which the organizer then
    // has two of and can toggle only one of.
    expect(mocks.listPortalItemsUncached).toHaveBeenCalledWith(EVENT)
  })
})

// An untouched task card renders in title order, so `Bio` (recTask2) is drawn ABOVE
// `Headshot` (recTask1), and that is what the editor posts back when nothing was dragged.
// A payload in any other sequence IS a drag, and `wasReordered` reads it as one.
const RENDERED_TASK_ORDER = ['recTask2', 'recTask1'] as const

describe('what it writes, and what it refuses to write', () => {
  it('writes nothing when the save changes nothing', async () => {
    const result = await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: RENDERED_TASK_ORDER.map((itemId, order) => row({ itemId, order })),
    })

    expect(result).toEqual({ ok: true, portalId: CUSTOM.id })
    expect(mocks.writePortalItems).toHaveBeenCalledWith({
      eventId: EVENT,
      portalId: CUSTOM.id,
      creates: [],
      patches: [],
    })
  })

  it('creates a row only for the surface whose switch left the kind default', async () => {
    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [
        row({ itemId: 'recTask2', order: 0 }),
        row({ itemId: 'recTask1', enabled: false, order: 1 }),
      ],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        creates: [{ itemType: 'task', itemId: 'recTask1', enabled: false, order: 1 }],
        patches: [],
      }),
    )
  })

  it('persists the whole card when a DRAG reordered rows that had no rows yet', async () => {
    // Found in review: absence means SHOWN for a task, so a pure drag moves no switch and
    // the old diff wrote nothing, silently reverting on the next read. The whole kind is
    // written rather than the two rows that swapped, because half a sequence leaves the rest
    // on the sentinel order an untouched row carries, which is an order nobody chose.
    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemId: 'recTask1', order: 0 }), row({ itemId: 'recTask2', order: 1 })],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        creates: [
          { itemType: 'task', itemId: 'recTask1', enabled: true, order: 0 },
          { itemType: 'task', itemId: 'recTask2', enabled: true, order: 1 },
        ],
        patches: [],
      }),
    )
  })

  it('creates a row for a RESOURCE the organizer switched ON, since absence hides those', async () => {
    // The asymmetry: a resource has no assignment behind it, so its row is the only
    // visibility state the schema can express, and no row means draft.
    mocks.listResources.mockResolvedValue([
      {
        id: 'recRes1',
        eventId: EVENT,
        title: 'Venue',
        slug: 'venue',
        visibility: 'portal',
        order: 0,
      },
    ])

    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemType: 'resource', itemId: 'recRes1', enabled: true })],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        creates: [{ itemType: 'resource', itemId: 'recRes1', enabled: true, order: 0 }],
      }),
    )
  })

  it('patches an existing row when its switch or its position moved', async () => {
    // recPi1 gives recTask1 a real order, so the card renders it first and recTask2 second.
    // Posting them the other way round is a drag, so recTask2 gains a row as well: see the
    // total-sequence reasoning above.
    mocks.listPortalItemsUncached.mockResolvedValue([
      item({ id: 'recPi1', taskId: 'recTask1', portalId: CUSTOM.id, enabled: false, order: 0 }),
    ])

    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemId: 'recTask2', order: 0 }), row({ itemId: 'recTask1', order: 1 })],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        creates: [{ itemType: 'task', itemId: 'recTask2', enabled: true, order: 0 }],
        patches: [{ id: 'recPi1', enabled: true, order: 1, portalId: undefined }],
      }),
    )
  })

  it('renumbers densely from 0 so a drag cannot leave two rows sharing a number', async () => {
    mocks.listPortalItemsUncached.mockResolvedValue([
      item({ id: 'recPi1', taskId: 'recTask1', portalId: CUSTOM.id, order: 7 }),
      item({ id: 'recPi2', taskId: 'recTask2', portalId: CUSTOM.id, order: 7 }),
    ])

    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemId: 'recTask2', order: 40 }), row({ itemId: 'recTask1', order: 90 })],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [
          { id: 'recPi2', enabled: true, order: 0, portalId: undefined },
          { id: 'recPi1', enabled: true, order: 1, portalId: undefined },
        ],
      }),
    )
  })

  it('stamps the portal link on a pre-5.0c row it is already patching, and only then', async () => {
    mocks.getPortal.mockResolvedValue(FALLBACK)
    mocks.listPortalItemsUncached.mockResolvedValue([
      // No `portal` link: the migration state, which reads as the event's default portal.
      item({ id: 'recPi1', taskId: 'recTask1', enabled: true, order: 0 }),
      item({ id: 'recPi2', taskId: 'recTask2', enabled: true, order: 1 }),
    ])

    await savePortalItemsAction({
      eventId: EVENT,
      portalId: FALLBACK.id,
      rows: [
        row({ itemId: 'recTask1', enabled: false, order: 0 }),
        row({ itemId: 'recTask2', order: 1 }),
      ],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledWith(
      expect.objectContaining({
        // recPi2 is unchanged, so it is not rewritten just to gain the link.
        patches: [{ id: 'recPi1', enabled: false, order: 0, portalId: FALLBACK.id }],
      }),
    )
  })

  it('refuses a row naming a record this event does not have, and writes nothing', async () => {
    const result = await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemId: 'recTaskFromAnotherConference' })],
    })

    expect(result.ok).toBe(false)
    expect(mocks.writePortalItems).not.toHaveBeenCalled()
  })

  it('refuses a CFP form, which strangers answer at a public URL and is no portal surface', async () => {
    mocks.listForms.mockResolvedValue([
      { id: 'recFormCfp', eventId: EVENT, name: 'Call for papers', kind: 'cfp' },
      { id: 'recFormTask', eventId: EVENT, name: 'Onboarding', kind: 'task' },
    ])

    const result = await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemType: 'form', itemId: 'recFormCfp' })],
    })

    expect(result.ok).toBe(false)
    expect(mocks.writePortalItems).not.toHaveBeenCalled()
  })

  it('reaches no assignment table: the one writer it can call is PortalItems', async () => {
    await savePortalItemsAction({
      eventId: EVENT,
      portalId: CUSTOM.id,
      rows: [row({ itemId: 'recTask1', enabled: false })],
    })

    expect(mocks.writePortalItems).toHaveBeenCalledTimes(1)
    expect(mocks.createPortal).not.toHaveBeenCalled()
    expect(mocks.deletePortal).not.toHaveBeenCalled()
    expect(mocks.updatePortal).not.toHaveBeenCalled()
  })
})
