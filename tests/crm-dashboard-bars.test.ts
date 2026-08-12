// The CRM dashboard month chart's bar heights.
//
// Pure, so it is assertable without a browser. What is pinned: that a month with sends always
// gets a bar tall enough to see (the defect that started this was a chart drawing month labels
// and counts with an empty plot area above them), that a month with none gets no bar at all,
// and that the peak month fills its track.

import { describe, expect, it } from 'vitest'
import { monthBarPercent } from '@/features/crm/dashboard-bars'

describe('monthBarPercent', () => {
  it('fills the track for the busiest month', () => {
    expect(monthBarPercent(7, 7)).toBe(100)
  })

  it('scales a month against the peak', () => {
    expect(monthBarPercent(3, 6)).toBe(50)
  })

  it('draws nothing for a month with no sends', () => {
    // Not the floor: a stub above an empty month draws activity that did not happen, and the
    // count is printed above the bar either way.
    expect(monthBarPercent(0, 7)).toBe(0)
  })

  it('keeps a tiny month visible rather than rounding it to a hairline', () => {
    // 1/40 rounds to 3%, which is two pixels on the 6rem track.
    expect(monthBarPercent(1, 40)).toBe(4)
  })

  it('draws nothing when nothing was ever sent', () => {
    // `peak` is 0 for an all-zero series, and the alternative is a division by zero rendered
    // as `height: NaN%`, which the browser drops and which nothing would catch.
    expect(monthBarPercent(0, 0)).toBe(0)
  })

  it('never overflows its track', () => {
    expect(monthBarPercent(9, 7)).toBe(100)
  })
})
