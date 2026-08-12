// The Submission Pacing chart's arithmetic, refs 34 and 35.
//
// The chart is nothing but date bucketing, which is exactly the operation that goes wrong
// silently: Workers run `Date` and `Intl` in UTC, so a submission filed at 9pm Pacific
// belongs to the NEXT day in UTC and lands on the wrong bar with nothing to show that it
// did. So the reference case here is a Los Angeles event and the boundary cases are
// evening submissions, and the module reads every instant through
// `@/features/agenda/time`.
//
// The other half of these tests is agreement with the tiles above the chart. A draft is
// not a submission (tests/dashboard-home.test.ts pins that for the forms row), so the line
// must not count one either: a pacing chart that climbs to 5 above a Submissions tile
// reading 4 makes the screen argue with itself.

import { describe, expect, it } from 'vitest'

import type { SubmissionStatus } from '@/constants/status'
import { cumulativeAt, signedCount, submissionPacing } from '@/features/dashboard/pacing'

/** Ref 34's event: October 12 2026 in Los Angeles, viewed on August 8, 65 days out. */
const EVENT = { startsAt: '2026-10-12T17:00:00.000Z', timezone: 'America/Los_Angeles' }
const NOW = new Date('2026-08-08T23:00:00.000Z')

const row = (submittedAt?: string, status: SubmissionStatus = 'pending') => ({
  status,
  submittedAt,
})

describe('submissionPacing', () => {
  it('accumulates by day and ends on the running total', () => {
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [
        row('2026-08-06T21:10:49.000Z'),
        row('2026-08-07T18:32:55.000Z'),
        row('2026-08-07T18:51:05.000Z'),
        row('2026-08-07T21:52:23.000Z'),
      ],
    })

    expect(view.points.map((point) => point.cumulative)).toEqual([0, 1, 4, 4])
    expect(view.stats.submissions).toBe(4)
    // Chronological, so a chart can draw it without sorting: T-minus counts DOWN.
    expect(view.points.map((point) => point.daysBefore)).toEqual([365, 67, 66, 65])
  })

  it('buckets in the EVENT timezone, not in the Workers runtime UTC', () => {
    // 04:00Z on the 9th is 9pm on the 8th in Los Angeles. Bucketed in UTC this submission
    // moves to the next day, which is a day the organizer's event never had.
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [row('2026-08-09T04:00:00.000Z')],
    })

    const jump = view.points.find((point) => point.cumulative === 1)
    expect(jump?.dateKey).toBe('2026-08-08')
    expect(jump?.daysBefore).toBe(65)
  })

  it('labels the x-axis exactly as ref 35 captured it', () => {
    const view = submissionPacing({ event: EVENT, now: NOW, submissions: [] })

    expect(view.ticks.map((tick) => tick.minusLabel)).toEqual([
      'T-365d',
      'T-290d',
      'T-215d',
      'T-140d',
      'T-65d',
    ])
    // The same ticks in Calendar date mode, so the toggle changes labels and not data.
    expect(view.ticks.at(-1)?.dateLabel).toBe('Aug 8')
    // T-365d from an October 2026 event is October 2025, and a bare "Oct 12" beside
    // "Aug 8" would read as eleven weeks rather than eleven months. So a tick outside the
    // current year carries its year. Authored: the reference never shows this mode on.
    expect(view.ticks.at(0)?.dateLabel).toBe('Oct 12, 2025')
  })

  it('fills the four mini stats ref 34 shows', () => {
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [
        row('2026-08-06T21:10:49.000Z'),
        row('2026-08-07T18:32:55.000Z'),
        row('2026-08-07T18:51:05.000Z'),
        row('2026-08-07T21:52:23.000Z'),
      ],
    })

    expect(view.stats.submissions).toBe(4)
    expect(view.stats.daysToEvent).toBe(65)
    expect(view.stats.thisWeekVsPrior).toBe(4)
    // No prior edition is wired, so the tile shows two dash placeholders (ref 34).
    expect(view.stats.vsPrior).toBeUndefined()
    // The label carries the CURRENT T-minus, which is what makes ref 34 read "T-65d".
    expect(view.stats.vsPriorLabel).toBe('vs prior (T-65d)')
  })

  it('measures this week against the week before it, not against everything', () => {
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [
        row('2026-08-07T18:00:00.000Z'),
        row('2026-08-03T18:00:00.000Z'),
        // 9 and 40 days ago: the first is last week, the second is neither week.
        row('2026-07-30T18:00:00.000Z'),
        row('2026-06-29T18:00:00.000Z'),
      ],
    })

    expect(view.stats.thisWeekVsPrior).toBe(1)
    expect(view.stats.submissions).toBe(4)
  })

  it('does not count a draft, which is what the tiles already decided', () => {
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [row('2026-08-07T18:00:00.000Z'), row('2026-08-07T19:00:00.000Z', 'draft')],
    })

    expect(view.stats.submissions).toBe(1)
    expect(view.points.at(-1)?.cumulative).toBe(1)
  })

  it('leaves a submission with no timestamp off the line rather than on today', () => {
    // It cannot be placed on a time axis, and putting it on the last day would draw a
    // spike on a date nothing happened. Recent Submissions still shows the row.
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [row(undefined), row('2026-08-07T18:00:00.000Z')],
    })

    expect(view.stats.submissions).toBe(1)
  })

  it('compares against a prior edition at the same T-minus when one is supplied', () => {
    const prior = [
      { daysBefore: 120, dateKey: '2025-06-01', cumulative: 0 },
      { daysBefore: 80, dateKey: '2025-07-11', cumulative: 3 },
      { daysBefore: 60, dateKey: '2025-07-31', cumulative: 9 },
    ]
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [row('2026-08-07T18:00:00.000Z')],
      prior,
    })

    // At T-65d the prior edition had 3, not 9: the later point is past the comparison.
    expect(view.stats.vsPrior).toBe(-2)
  })

  it('anchors on today when the event has no start date', () => {
    // There is no T-minus without a start date, so the card drops the toggle rather than
    // printing "T-NaNd", and the countdown tile has nothing to say.
    const view = submissionPacing({
      event: { timezone: 'America/Los_Angeles' },
      now: NOW,
      submissions: [row('2026-08-07T18:00:00.000Z')],
    })

    expect(view.anchor).toBe('today')
    expect(view.stats.daysToEvent).toBeUndefined()
    expect(view.points.at(-1)?.daysBefore).toBe(0)
  })

  it('keeps a started event on the axis instead of inverting it', () => {
    const view = submissionPacing({
      event: EVENT,
      now: new Date('2026-10-20T23:00:00.000Z'),
      submissions: [row('2026-08-07T18:00:00.000Z')],
    })

    expect(view.stats.daysToEvent).toBe(-8)
    expect(view.ticks.at(-1)?.minusLabel).toBe('T+8d')
    // Still descending, which is what keeps the chart's x-axis monotonic.
    const values = view.points.map((point) => point.daysBefore)
    expect(values).toEqual([...values].sort((left, right) => right - left))
  })
})

describe('cumulativeAt', () => {
  it('reads the value in force at a T-minus, not the nearest point', () => {
    const points = [
      { daysBefore: 100, dateKey: '2025-01-01', cumulative: 0 },
      { daysBefore: 40, dateKey: '2025-03-02', cumulative: 5 },
      { daysBefore: 10, dateKey: '2025-04-01', cumulative: 12 },
    ]

    expect(cumulativeAt(points, 40)).toBe(5)
    expect(cumulativeAt(points, 39)).toBe(5)
    expect(cumulativeAt(points, 120)).toBe(0)
    expect(cumulativeAt(points, 0)).toBe(12)
  })
})

describe('signedCount', () => {
  it('signs a gain the way ref 34 prints it', () => {
    expect(signedCount(4)).toBe('+4')
    expect(signedCount(-3)).toBe('-3')
    expect(signedCount(0)).toBe('0')
  })
})
