// Where a widget sits in its grid: the next order an add takes, how the grid sorts, and the
// swap behind Move up and Move down.
//
// `swapWidgetOrder` is tested against the case it exists for and that no screen would show: a
// dashboard holding a row the grid cannot draw. `listWidgetRowsUncached` is unmapped, so that
// row is in the list the writer renumbers and is not in the list the organizer sees, and a move
// computed as "index minus one" over the writer's list swaps a visible widget with an invisible
// one. That renders as a menu item that did nothing while having written to Airtable.

import { describe, expect, it } from 'vitest'

import { byWidgetOrder, nextWidgetOrder, swapWidgetOrder } from '@/features/dashboard/widget-order'

describe('nextWidgetOrder', () => {
  it('starts at zero and then goes one past the highest, not the row count', () => {
    expect(nextWidgetOrder([])).toBe(0)
    // Three widgets that lost the middle one. `length` would hand out 2, which is taken.
    expect(nextWidgetOrder([{ order: 0 }, { order: 2 }])).toBe(3)
  })
})

describe('byWidgetOrder', () => {
  it('breaks a tie on record id so the grid cannot reshuffle between requests', () => {
    const rows = [
      { id: 'recC', order: 1 },
      { id: 'recA', order: 1 },
      { id: 'recB', order: 0 },
    ]

    expect(rows.toSorted(byWidgetOrder).map((row) => row.id)).toEqual(['recB', 'recA', 'recC'])
  })
})

describe('swapWidgetOrder', () => {
  const IDS = ['recA', 'recB', 'recC']

  it('exchanges two adjacent widgets and leaves the rest where they were', () => {
    expect(swapWidgetOrder(IDS, 'recB', 'recA')).toEqual(['recB', 'recA', 'recC'])
    expect(swapWidgetOrder(IDS, 'recB', 'recC')).toEqual(['recA', 'recC', 'recB'])
  })

  it('exchanges across a row the grid cannot draw rather than swapping into it', () => {
    // recHidden is unreadable, so the organizer sees recA above recC and Move up on recC names
    // recA. The hidden row keeps its place in the middle and both visible cards move.
    const withHidden = ['recA', 'recHidden', 'recC']

    expect(swapWidgetOrder(withHidden, 'recC', 'recA')).toEqual(['recC', 'recHidden', 'recA'])
  })

  it('refuses an id that is not on this dashboard, so a stale post writes nothing', () => {
    expect(swapWidgetOrder(IDS, 'recA', 'recGone')).toBeUndefined()
    expect(swapWidgetOrder(IDS, 'recGone', 'recA')).toBeUndefined()
  })

  it('refuses a widget swapped with itself rather than renumbering every row for nothing', () => {
    expect(swapWidgetOrder(IDS, 'recA', 'recA')).toBeUndefined()
  })

  it('never loses or duplicates a widget', () => {
    const moved = swapWidgetOrder(IDS, 'recA', 'recC')

    expect(moved).toHaveLength(IDS.length)
    expect(new Set(moved).size).toBe(IDS.length)
  })
})
