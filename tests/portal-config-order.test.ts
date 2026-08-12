// Three ordering defects review found in the portals feature, and the rules that replaced
// them. All three share a shape: the code took a count or a payload at face value where the
// safe reading needed one more question asked.
//
// They are together in one file because they are one concern (what `order` a row ends up
// with, and who decides it) split across the client, the action and the diff.

import { describe, expect, it } from 'vitest'

import { portalItemWrites } from '@/app/(admin)/admin/[eventId]/(organizer)/portals/portal-item-kinds'
import type { PortalContent } from '@/features/portal-config/content'
import { nextPortalOrder } from '@/features/portal-config/invariants'
import { planPortalItems } from '@/features/portal-config/items'
import type { Portal } from '@/types/portals'

const EVENT = 'recEvent1'

function portal(over: Partial<Portal> & { id: string }): Portal {
  return {
    eventId: EVENT,
    name: over.id,
    kind: 'contacts',
    isDefault: false,
    order: 0,
    filters: { contactTypes: [], rules: [] },
    alwaysShowTasks: false,
    manageProfile: false,
    ...over,
  }
}

describe('nextPortalOrder', () => {
  it('is one past the highest order in use, not the count', () => {
    // The failing sequence review gave: orders 0, 1, 2, then the middle portal is deleted.
    // A delete leaves a gap deliberately, because a gap is not a tie. `portals.length` is
    // now 2 and a portal already sits at 2, so the old code handed the new portal a number
    // another row was already holding.
    const afterDelete = [portal({ id: 'recA', order: 0 }), portal({ id: 'recC', order: 2 })]

    expect(nextPortalOrder(afterDelete)).toBe(3)
    expect(afterDelete.some((row) => row.order === nextPortalOrder(afterDelete))).toBe(false)
  })

  it('starts at 0 on an event with no portals at all', () => {
    // -1 plus one. Worth pinning: an event mid-creation has read its portals before the
    // default has been written, and a first portal landing on 1 would leave 0 unused forever.
    expect(nextPortalOrder([])).toBe(0)
  })

  it('places a new portal last even when the existing orders are dense', () => {
    const dense = [portal({ id: 'recA', order: 0 }), portal({ id: 'recB', order: 1 })]

    expect(nextPortalOrder(dense)).toBe(2)
  })
})

describe('portalItemWrites', () => {
  const content: PortalContent = {
    task: [
      { itemType: 'task', itemId: 'recTaskB', title: 'Bio', enabled: true, order: 0 },
      { itemType: 'task', itemId: 'recTaskA', title: 'Headshot', enabled: true, order: 1 },
    ],
    form: [],
    file_request: [],
    resource: [],
  }

  it('posts every row of the card, including untouched ones', () => {
    // Review's finding, and the client half of the drag defect: this used to drop rows whose
    // switch still read the kind's absence default, which is EVERY task on a fresh event. A
    // drag moves no switch, so the whole card was filtered out and the save posted nothing.
    // The filtering did not disappear, it moved to `planPortalItems`, which can still decline
    // to write an unchanged row but can now also see that the sequence changed.
    expect(portalItemWrites(content)).toEqual([
      { itemType: 'task', itemId: 'recTaskB', enabled: true, order: 0 },
      { itemType: 'task', itemId: 'recTaskA', enabled: true, order: 1 },
    ])
  })

  it('numbers by position on screen, not by the row order it was built with', () => {
    // An untouched row carries the sentinel order `buildPortalContent` gives it, so posting
    // `row.order` would state a sequence the screen is not showing.
    const sentinel: PortalContent = {
      ...content,
      task: content.task.map((row) => ({ ...row, order: Number.MAX_SAFE_INTEGER })),
    }

    expect(portalItemWrites(sentinel).map((row) => row.order)).toEqual([0, 1])
  })
})

describe('planPortalItems, on a payload naming one item twice', () => {
  const content: PortalContent = {
    task: [{ itemType: 'task', itemId: 'recTask1', title: 'Headshot', enabled: true, order: 0 }],
    form: [],
    file_request: [],
    resource: [],
  }

  it('keeps the first position and drops the repeat, rather than writing two rows', () => {
    // Review's finding: the payload was taken at face value, so one task posted twice
    // produced two creates in a single batch and a (portal, item) pair holding two rows.
    // Nothing downstream could catch it, because both halves land in the same write.
    const result = planPortalItems(portal({ id: 'recPortal', isDefault: true }), content, [
      { itemType: 'task', itemId: 'recTask1', enabled: false, order: 0 },
      { itemType: 'task', itemId: 'recTask1', enabled: true, order: 1 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.creates).toEqual([
      { itemType: 'task', itemId: 'recTask1', enabled: false, order: 0 },
    ])
  })
})
