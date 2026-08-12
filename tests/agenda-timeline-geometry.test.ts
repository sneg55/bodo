// How wide the day/week/rooms grid is, and whether it can still be scrolled.
//
// The property under test is the one the eval run of 2026-08-10 filed: with seven rooms only
// three were reachable at a 1600px viewport, and the rest came into view only by widening the
// browser to about 3400px. Two things caused that, and both are numbers now rather than
// Tailwind classes, so both can be asserted here instead of measured in a browser:
//
//   - every lane was floored at 12rem, which seven of cannot fit; and
//   - the grid wrapper was `min-w-max`, so the widest session title on the day set the track
//     width, which is where the 3400px came from.
//
// So the tests are about the arithmetic a viewport has to satisfy, plus the paging buttons
// that reach whatever is still off screen once it does.

import { describe, expect, it } from 'vitest'

import {
  laneWidthRem,
  REM_PX,
  scrollReach,
  scrollStep,
  TIME_COLUMN_REM,
  timelineColumns,
  timelineMinWidthRem,
} from '@/features/agenda/timeline/timeline-geometry'

/**
 * What the grid half of the agenda actually gets at a 1600px viewport: the admin sidebar,
 * the page padding, the 18rem unscheduled tray and the gap between them come off first.
 * Deliberately pessimistic, so a pass here is not a pass that depends on a tight measurement.
 */
const GRID_WIDTH_AT_1600 = 990

describe('lane width', () => {
  it('keeps 12rem for the common three and four room shapes', () => {
    expect(laneWidthRem(1)).toBe(12)
    expect(laneWidthRem(3)).toBe(12)
    expect(laneWidthRem(4)).toBe(12)
  })

  it('narrows as lanes are added, so more of them fit at once', () => {
    expect(laneWidthRem(5)).toBeLessThan(laneWidthRem(4))
    expect(laneWidthRem(7)).toBeLessThan(laneWidthRem(5))
  })

  it('never narrows below something a session card can be read in', () => {
    for (const count of [5, 7, 12, 40]) {
      expect(laneWidthRem(count)).toBeGreaterThanOrEqual(8)
    }
  })
})

describe('grid width', () => {
  it('fits seven rooms in the grid half of a 1600px viewport', () => {
    expect(timelineMinWidthRem(7) * REM_PX).toBeLessThanOrEqual(GRID_WIDTH_AT_1600)
  })

  it('is the clock gutter plus one floor per lane, and nothing content can widen', () => {
    expect(timelineMinWidthRem(7)).toBe(TIME_COLUMN_REM + 7 * laneWidthRem(7))
    expect(timelineMinWidthRem(0)).toBe(TIME_COLUMN_REM)
  })

  it('grows with the lane count, so an eighth room is scrolled to rather than dropped', () => {
    expect(timelineMinWidthRem(9)).toBeGreaterThan(timelineMinWidthRem(7))
  })
})

describe('grid template', () => {
  it('floors every lane and lets it share the rest', () => {
    expect(timelineColumns(7)).toBe('4.5rem repeat(7, minmax(8rem, 1fr))')
    expect(timelineColumns(3)).toBe('4.5rem repeat(3, minmax(12rem, 1fr))')
  })

  it('emits no repeat(0), which is invalid CSS and would drop the whole declaration', () => {
    expect(timelineColumns(0)).toBe('4.5rem')
    expect(timelineColumns(-1)).toBe('4.5rem')
  })
})

describe('scroll reach', () => {
  it('is dead in both directions when nothing is off screen', () => {
    expect(scrollReach(0, 900, 900)).toEqual({ start: false, end: false })
  })

  it('offers only forward at the start of an overflowing track', () => {
    expect(scrollReach(0, 1800, 900)).toEqual({ start: false, end: true })
  })

  it('offers only backward at the end of it', () => {
    expect(scrollReach(900, 1800, 900)).toEqual({ start: true, end: false })
  })

  it('offers both in the middle', () => {
    expect(scrollReach(400, 1800, 900)).toEqual({ start: true, end: true })
  })

  it('treats a sub-pixel remainder as the end, so the button is not left live', () => {
    expect(scrollReach(899.6, 1800, 900).end).toBe(false)
    expect(scrollReach(0.4, 1800, 900).start).toBe(false)
  })
})

describe('scroll step', () => {
  it('stops just short of a viewport, so no column is jumped clean over', () => {
    const step = scrollStep(900, 7)
    expect(step).toBeLessThan(900)
    expect(step).toBe(900 - laneWidthRem(7) * REM_PX)
  })

  it('still travels a lane when the viewport is narrower than one', () => {
    expect(scrollStep(100, 7)).toBe(laneWidthRem(7) * REM_PX)
    expect(scrollStep(0, 3)).toBeGreaterThan(0)
  })
})
