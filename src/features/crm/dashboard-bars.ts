// How tall a bar on the CRM dashboard's month chart is drawn.
//
// Its own module rather than a helper inside `CrmDashboardCards.tsx`, because it is the one
// piece of that chart that is a RULE rather than markup, and rules in this project ship with
// tests (`tests/crm-dashboard-bars.test.ts`). `dashboard.ts` is at the file-size limit, which
// is the other reason it is not there.

/**
 * The floor a NON-EMPTY month's bar is drawn at, as a percentage of its track.
 *
 * One send against a peak of forty rounds to 3%, which on the chart's 6rem track is two
 * pixels and reads as though nothing happened that month. Four percent is the smallest slab
 * that still looks like a slab.
 */
const MIN_BAR_PERCENT = 4

/**
 * How tall one month's bar is, as a percentage of the track it sits in.
 *
 * Relative to the busiest month rather than to a fixed ceiling, for the reason
 * `MonthBarsCard` records: the question the chart answers is about SHAPE, and an absolute
 * scale flattens a small conference's year into twelve invisible stubs.
 *
 * A month with no sends gets NO bar, not the floor. The floor exists so that a small number
 * is still visible; applying it to zero would draw activity that did not happen, and the
 * count is printed above the bar either way.
 */
export function monthBarPercent(count: number, peak: number): number {
  if (count <= 0 || peak <= 0) return 0
  return Math.max(MIN_BAR_PERCENT, Math.min(100, Math.round((count / peak) * 100)))
}
