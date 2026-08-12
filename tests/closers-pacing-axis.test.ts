// Submission pacing against the changelog screenshot of the same card.
//
// That screenshot (docs/parity/external-references.md) is a populated version of ref 34 for an
// event 74 days out. It settles two things our own captures could not, because ours was taken 65
// days out and had no prior edition:
//
//   - the comparison tile's label is DERIVED, not a constant: it reads `vs prior (T-74d)` there
//     against `vs prior (T-65d)` in ours, and the only thing that changed is days-to-event
//   - the x-axis ticks read `T-365d`, `T-292d`, `T-219d`, `T-147d`, `T-74d`, and the middle one
//     falls at exactly 219.5 days, so a tick lands on a whole day by rounding DOWN
//
// The x-axis mode toggle the screenshot shows (`Days before event`, active, and `Calendar date`)
// is the reason each tick carries BOTH labels: flipping it must relabel the same series rather
// than re-bucket anything, since bucketing happens on the server in the event's timezone and the
// chart is a client component on the viewer's clock.

import { describe, expect, it } from 'vitest'

import { type PacingPoint, submissionPacing } from '@/features/dashboard/pacing'
import type { Submission } from '@/types/domain'

/** 74 days before the event start below, which is what the screenshot was taken at. */
const NOW = new Date('2026-07-30T12:00:00.000Z')
const EVENT = { timezone: 'America/Los_Angeles', startsAt: '2026-10-12T16:00:00.000Z' }

function row(submittedAt: string): Pick<Submission, 'status' | 'submittedAt'> {
  return { status: 'pending', submittedAt }
}

describe('the comparison tile label', () => {
  it('carries the T-minus of the day it is read, which is T-74d in the reference', () => {
    const view = submissionPacing({ event: EVENT, now: NOW, submissions: [] })

    expect(view.stats.daysToEvent).toBe(74)
    expect(view.stats.vsPriorLabel).toBe('vs prior (T-74d)')
  })

  it('tracks days-to-event rather than sitting on one offset', () => {
    const labels = ['2026-07-30', '2026-08-08', '2026-10-11'].map(
      (day) =>
        submissionPacing({ event: EVENT, now: new Date(`${day}T12:00:00.000Z`), submissions: [] })
          .stats.vsPriorLabel,
    )

    expect(labels).toEqual(['vs prior (T-74d)', 'vs prior (T-65d)', 'vs prior (T-1d)'])
  })

  it('compares at that same offset when a prior edition is supplied', () => {
    const prior: readonly PacingPoint[] = [
      { daysBefore: 90, dateKey: '2025-07-14', cumulative: 200 },
      { daysBefore: 74, dateKey: '2025-07-30', cumulative: 656 },
      { daysBefore: 10, dateKey: '2025-10-02', cumulative: 900 },
    ]
    const view = submissionPacing({
      event: EVENT,
      now: NOW,
      submissions: [row('2026-07-29T18:00:00.000Z'), row('2026-07-29T19:00:00.000Z')],
      prior,
    })

    // The reference's populated tile subtracts the prior edition's total AT T-74d (656), not its
    // final one: crediting the prior edition with days it had not lived through is the bug
    // `cumulativeAt` exists to avoid.
    expect(view.stats.vsPrior).toBe(2 - 656)
  })
})

describe('the x-axis', () => {
  it('labels its five ticks exactly as the reference screenshot does', () => {
    const view = submissionPacing({ event: EVENT, now: NOW, submissions: [] })

    expect(view.ticks.map((tick) => tick.minusLabel)).toEqual([
      'T-365d',
      'T-292d',
      'T-219d',
      'T-147d',
      'T-74d',
    ])
  })

  it('rounds a tick that falls between two days down, which is where T-219d comes from', () => {
    // The middle tick of a 291-day span starting at 365 sits at 219.5. Rounding half up gives
    // T-220d, and T-220d is not what the product prints.
    const view = submissionPacing({ event: EVENT, now: NOW, submissions: [] })

    expect(view.ticks.at(2)?.daysBefore).toBe(219)
  })

  it('carries a calendar label on every tick, so the mode toggle relabels and never re-buckets', () => {
    const view = submissionPacing({ event: EVENT, now: NOW, submissions: [] })

    // Same count, same order, same `daysBefore`: the toggle is presentation over one series.
    expect(view.ticks).toHaveLength(5)
    expect(view.ticks.every((tick) => tick.dateLabel.length > 0)).toBe(true)
    expect(view.ticks.at(-1)?.dateLabel).toBe('Jul 30')
  })

  it('offers the Days before event mode only when there is an event date to count to', () => {
    // `anchor` is what the card reads to decide whether to render the toggle at all: with no
    // start date there is no T-minus, and a toggle whose active state would print "T-NaNd" is
    // worse than no toggle.
    const anchored = submissionPacing({ event: EVENT, now: NOW, submissions: [] })
    const floating = submissionPacing({
      event: { timezone: EVENT.timezone },
      now: NOW,
      submissions: [],
    })

    expect(anchored.anchor).toBe('event')
    expect(floating.anchor).toBe('today')
    expect(floating.stats.daysToEvent).toBeUndefined()
  })

  it('reads the calendar label in the EVENT timezone, not the runtime UTC', () => {
    // 2026-07-30T02:00Z is still 2026-07-29 in Los Angeles, so the axis ends a day earlier than
    // a UTC reading of the same instant would put it. Workers runs Date and Intl in UTC, which
    // is what makes this the day boundary a pacing axis slips on.
    const view = submissionPacing({
      event: EVENT,
      now: new Date('2026-07-30T02:00:00.000Z'),
      submissions: [],
    })

    expect(view.ticks.at(-1)?.dateLabel).toBe('Jul 29')
  })
})
