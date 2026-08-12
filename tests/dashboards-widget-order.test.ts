// Where a widget lands in its grid, and where it stays.
//
// Both rules were wrong together and each hid the other. `addWidgetAction` used the row COUNT as
// the next `order`, which stops being one past the highest as soon as a widget is deleted, and the
// grid sorted on `order` alone, so the collision that produced rendered in whatever sequence
// Airtable's page happened to come back in. The visible symptom is a widget swapping places with
// another between two refreshes of a screen nobody touched. Found by Codex review.

import { describe, expect, it } from 'vitest'
import { byWidgetOrder, nextWidgetOrder } from '@/features/dashboard/widget-order'

describe('nextWidgetOrder', () => {
  it('starts at zero on an empty dashboard', () => {
    expect(nextWidgetOrder([])).toBe(0)
  })

  it('is one past the highest order, not the row count', () => {
    // The regression case: three widgets were added and the middle one deleted, so two rows hold
    // 0 and 2. `rows.length` is 2, which is an order the grid already has.
    expect(nextWidgetOrder([{ order: 0 }, { order: 2 }])).toBe(3)
  })

  it('ignores gaps and duplicates in the stored orders', () => {
    expect(nextWidgetOrder([{ order: 7 }, { order: 1 }, { order: 7 }])).toBe(8)
  })

  it('does not go backwards for a row somebody set to a negative order in Airtable', () => {
    // The column is a plain number and reachable from the Airtable UI. A negative order still
    // sorts first, but the next widget must not be handed a negative one.
    expect(nextWidgetOrder([{ order: -5 }])).toBe(0)
  })
})

describe('byWidgetOrder', () => {
  it('sorts by order ascending', () => {
    const rows = [
      { id: 'recC', order: 2 },
      { id: 'recA', order: 0 },
      { id: 'recB', order: 1 },
    ]

    expect(rows.toSorted(byWidgetOrder).map((row) => row.id)).toEqual(['recA', 'recB', 'recC'])
  })

  it('breaks a tie on record id, so a collided grid does not reshuffle', () => {
    // Two adds racing each other both read the same highest order. Airtable's own sort leaves
    // that tie unresolved, so without this the two widgets can come back either way round.
    const rows = [
      { id: 'recZ', order: 1 },
      { id: 'recA', order: 1 },
    ]

    expect(rows.toSorted(byWidgetOrder).map((row) => row.id)).toEqual(['recA', 'recZ'])
    // Same set, opposite input order, same answer: that is the property that matters.
    expect(
      rows
        .toReversed()
        .toSorted(byWidgetOrder)
        .map((row) => row.id),
    ).toEqual(['recA', 'recZ'])
  })

  it('is a total order, so sorting is idempotent', () => {
    const rows = [
      { id: 'recB', order: 1 },
      { id: 'recA', order: 1 },
      { id: 'recC', order: 0 },
    ]
    const once = rows.toSorted(byWidgetOrder)

    expect(once.toSorted(byWidgetOrder)).toEqual(once)
  })
})
