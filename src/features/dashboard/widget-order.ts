// Where a widget sits in its grid: the order the next one gets, and how the grid sorts.
//
// Both rules live here rather than at their call sites because they are two halves of one
// property and were wrong together. `addWidgetAction` used the row COUNT as the next order, which
// stops being one past the highest the moment a widget is deleted, and the grid sorted on `order`
// alone, so the collision that produced then rendered in whatever sequence Airtable's page
// happened to come back in. Either alone is invisible; together they move a widget under the
// organizer between two refreshes of the same screen. Found by Codex review.
//
// Ties still happen and are not treated as a fault: two adds racing each other both read the same
// highest order, and Airtable has no counter to allocate from. So the sort has a total tie-break
// on record id, which is stable across requests and is the same tie-break `dashboardTabs` uses on
// the strip.

/** Enough of a widget row to place it. `reads-dashboards.ts` reads exactly this for the writer. */
type Placed = { order: number }

/** Enough to place it AND to break a tie. */
type Identified = Placed & { id: string }

/**
 * One past the highest `order` present, and 0 for the first widget.
 *
 * Deliberately not `rows.length`: a dashboard that had three widgets and lost the middle one has
 * two rows holding orders 0 and 2, and `length` would hand the next widget order 2 as well.
 */
export function nextWidgetOrder(rows: readonly Placed[]): number {
  return rows.reduce((highest, row) => Math.max(highest, row.order + 1), 0)
}

/** `order` ascending, record id ascending within a tie. Total, so the grid never reshuffles. */
export function byWidgetOrder(left: Identified, right: Identified): number {
  return left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order
}

/**
 * Two widgets exchanged in the placed list, or `undefined` when either id is not in it.
 *
 * A SWAP of two named ids rather than "move the widget at index N up one", and the reason is
 * the row this grid cannot draw. `listWidgetRowsUncached` is unmapped on purpose, so a row whose
 * `metric` cell was blanked in Airtable is in the writer's list and not on the organizer's
 * screen. An index move computed over the writer's list would then swap a visible widget with an
 * invisible one, which persists a real change and renders as a button that did nothing. The card
 * knows what is next to it on screen, so it names its neighbour and this exchanges exactly those
 * two, leaving anything unreadable between them where it is.
 *
 * `undefined` rather than the list unchanged, so the action refuses a stale id instead of
 * rewriting every row's `order` to the values they already hold.
 */
export function swapWidgetOrder(
  ids: readonly string[],
  first: string,
  second: string,
): readonly string[] | undefined {
  if (first === second || !ids.includes(first) || !ids.includes(second)) return undefined

  return ids.map((id) => {
    if (id === first) return second
    if (id === second) return first
    return id
  })
}
