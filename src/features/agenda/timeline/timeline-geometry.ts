// How wide the day/week/rooms grid is, and how far its columns can be scrolled.
//
// WHY THIS IS ITS OWN FILE. The eval run of 2026-08-10 filed the rooms grid as clipped:
// with seven rooms only three were reachable at a 1600px viewport, and the off-screen four
// came into view only by widening the browser to about 3400px. Nothing was scrollable by
// wheel or by page scroll, so four of the seven rooms were effectively invisible.
//
// The cause was the width being decided by the CONTENT rather than by the layout. The grid
// wrapper carried `min-w-max`, so the widest session title on the day and the longest room
// name set the track width, on top of a 12rem floor per column that seven rooms alone
// cannot fit. Both halves are decided here now, as numbers rather than as Tailwind classes,
// so they can be asserted in `tests/agenda-timeline-geometry.test.ts` instead of measured in
// a browser: `timeline-model.ts` is at its line budget, and this is a separate concern from
// where a session sits in the grid.

/** The gutter that holds the clock, in rem. */
export const TIME_COLUMN_REM = 4.5

/** Assumed root font size. Only used to turn the rem floors into a pixel scroll step. */
export const REM_PX = 16

/**
 * The narrowest one lane column may be, in rem, given how many there are.
 *
 * It steps down as lanes are added. Seven rooms then need 4.5 + 7 x 8 = 60.5rem (968px),
 * which fits the grid half of the agenda at an ordinary laptop width, so all seven are on
 * screen at once and the defect above does not arise at all. Anything past that still
 * overflows, and TimelineGrid's paging buttons are what reaches it.
 *
 * Three and four lanes keep the 12rem they had: that is the common shape and it already
 * read well, so this only narrows the case that was actually broken.
 */
export function laneWidthRem(laneCount: number): number {
  if (laneCount <= 4) return 12
  if (laneCount <= 6) return 10
  return 8
}

/**
 * `grid-template-columns` for the header row and for the slot grid, which must agree.
 *
 * `repeat(0, ...)` is invalid CSS and drops the whole declaration, so a lane-less grid (no
 * date picked, no rooms) gets the clock gutter alone rather than a broken rule.
 */
export function timelineColumns(laneCount: number): string {
  if (laneCount <= 0) return `${String(TIME_COLUMN_REM)}rem`
  const lane = String(laneWidthRem(laneCount))
  return `${String(TIME_COLUMN_REM)}rem repeat(${String(laneCount)}, minmax(${lane}rem, 1fr))`
}

/**
 * The width the grid keeps when the viewport is narrower than it, in rem.
 *
 * This is what replaces `min-w-max`. A definite minimum means the columns are floored by
 * the LAYOUT and never widened by a long title, and above it every track is `1fr`, so the
 * grid still fills a wide screen.
 */
export function timelineMinWidthRem(laneCount: number): number {
  return TIME_COLUMN_REM + Math.max(laneCount, 0) * laneWidthRem(laneCount)
}

/**
 * Which way a horizontal scroller can still travel.
 *
 * Pure so the affordance can be asserted without a DOM: the paging buttons are enabled from
 * this and hidden when neither direction is live, because a control that is enabled with
 * nowhere to go is the dead control the same eval run filed elsewhere. The 1px tolerance is
 * for fractional scroll positions, which a zoomed or high-DPI viewport reports and which
 * would otherwise leave the end button live at the end of the track.
 */
export function scrollReach(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): { start: boolean; end: boolean } {
  const max = scrollWidth - clientWidth
  if (max <= 1) return { start: false, end: false }
  return { start: scrollLeft > 1, end: scrollLeft < max - 1 }
}

/**
 * How far one press of a paging button travels, in pixels.
 *
 * Just under a viewport, so a column is never jumped clean over between presses, with a
 * floor of one lane for a viewport narrower than that.
 */
export function scrollStep(clientWidth: number, laneCount: number): number {
  const lane = laneWidthRem(laneCount) * REM_PX
  return Math.max(clientWidth - lane, lane)
}
