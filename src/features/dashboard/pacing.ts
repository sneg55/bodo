// The Submission Pacing card's arithmetic, refs 34 and 35.
//
// Pure and in its own module because a pacing chart is nothing but date bucketing, and
// date bucketing on Workers is where a dashboard quietly lies: the runtime's `Date` and
// `Intl` are UTC, so a talk filed at 9pm Pacific belongs to the next day unless every
// instant is read in the EVENT's timezone. Every read below goes through
// `@/features/agenda/time`, which is also where the invalid-timezone guard lives, and a
// raw `toLocaleDateString` anywhere in here would shift a day with nothing to show for it.
//
// The chart component draws what this hands it and computes nothing: it is a client
// component (recharts), so arithmetic in there would run twice, on two clocks, in two
// timezones.
//
// Agreement with the tiles above the chart is a requirement, not a nicety. A `draft` is
// not a submission (tests/dashboard-home.test.ts pins that for the forms row), so the line
// does not count one either. Tested in tests/dashboard-pacing.test.ts.

import { dateKeyAt, formatAgendaDate } from '@/features/agenda/time'
import type { Event, Submission } from '@/types/domain'

/** The run-up the chart shows by default. Ref 35's axis starts at T-365d. */
const DEFAULT_WINDOW_DAYS = 365
/**
 * The shortest axis worth drawing, for an event further out than the window: without a
 * floor the domain inverts (start before end) and recharts draws a chart with no width.
 */
const MIN_SPAN_DAYS = 90
/** Ref 35 shows five: T-365d, T-290d, T-215d, T-140d, T-65d. */
const TICK_COUNT = 5
const DAY_MS = 86_400_000

export type PacingPoint = {
  /** Days before the anchor day. Counts DOWN over time, and goes negative after it. */
  daysBefore: number
  /** `2026-08-08`, the day this point closes, in the event's timezone. */
  dateKey: string
  /** Submissions received up to and including that day. */
  cumulative: number
}

/** One x-axis tick, carrying both labels so the toggle changes labels and not data. */
export type PacingTick = {
  daysBefore: number
  /** `T-65d`, ref 35. */
  minusLabel: string
  /** `Aug 8`, for Calendar date mode. */
  dateLabel: string
}

export type PacingStats = {
  /** Ref 34's "Submissions" mini stat, and the line's final value. */
  submissions: number
  /** `vs prior (T-65d)`: the label carries the current T-minus, as ref 34 does. */
  vsPriorLabel: string
  /** Absent with no prior edition, which is the two-dash state ref 34 shows. */
  vsPrior?: number
  /** Absent when the event has no start date, rather than rendered as 0. */
  daysToEvent?: number
  /** Ref 34's "This week vs prior": last seven days minus the seven before them. */
  thisWeekVsPrior: number
}

export type PacingView = {
  /**
   * What T-minus is measured from. `today` when the event has no start date, in which case
   * there is no countdown and the card drops the "Days before event" axis rather than
   * printing a T-minus to a date nobody has set.
   */
  anchor: 'event' | 'today'
  points: readonly PacingPoint[]
  ticks: readonly PacingTick[]
  stats: PacingStats
}

type Row = Pick<Submission, 'status' | 'submittedAt'>

export function submissionPacing(input: {
  submissions: readonly Row[]
  event: Pick<Event, 'timezone'> & { startsAt?: string }
  now: Date
  /**
   * A prior edition's own series, for the "vs prior" tile. Nothing in this build supplies
   * one: picking a prior event needs a cross-event read, so the tile renders its captured
   * empty state. The parameter is here because the comparison is the arithmetic, and it is
   * cheaper to have it tested than to add it later next to a picker.
   */
  prior?: readonly PacingPoint[]
  windowDays?: number
}): PacingView {
  const zone = input.event.timezone
  const todayKey = dateKeyAt(input.now.toISOString(), zone)
  const startKey =
    input.event.startsAt === undefined ? undefined : dateKeyAt(input.event.startsAt, zone)
  const anchorKey = startKey ?? todayKey
  const anchor: PacingView['anchor'] = startKey === undefined ? 'today' : 'event'
  if (todayKey === undefined || anchorKey === undefined) {
    return { anchor: 'today', points: [], ticks: [], stats: emptyStats(0) }
  }

  const days = receivedByDay(input.submissions, zone, anchorKey)
  const end = dayGap(todayKey, anchorKey)
  const span = Math.max(
    (input.windowDays ?? DEFAULT_WINDOW_DAYS) - end,
    MIN_SPAN_DAYS,
    (days.at(0)?.daysBefore ?? end) - end,
  )
  const start = end + span

  const points = seriesPoints({ days, start, end, todayKey, anchorKey })
  const total = points.at(-1)?.cumulative ?? 0

  return {
    anchor,
    points,
    ticks: axisTicks({ anchorKey, todayKey, start, span }),
    stats: {
      submissions: total,
      vsPriorLabel: `vs prior (${tMinusLabel(end)})`,
      ...(input.prior === undefined ? {} : { vsPrior: total - cumulativeAt(input.prior, end) }),
      ...(startKey === undefined ? {} : { daysToEvent: end }),
      thisWeekVsPrior: weekOverWeek(days, end),
    },
  }
}

/** `+4`, ref 34. Zero is `0` and not `+0`: nothing happened is not a gain. */
export function signedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/**
 * The cumulative total in force at a T-minus: the last point at or before it.
 *
 * Not the nearest point, which is the bug this exists to avoid: comparing this edition at
 * T-65d against a prior edition's T-60d total credits the prior edition with five days it
 * had not lived through yet.
 */
export function cumulativeAt(points: readonly PacingPoint[], daysBefore: number): number {
  let value = 0
  for (const point of points) {
    if (point.daysBefore < daysBefore) break
    value = point.cumulative
  }
  return value
}

type DayCount = { dateKey: string; daysBefore: number; count: number }

/**
 * Submissions per day, newest last, with the two exclusions the rest of the home already
 * makes: a `draft` is not a submission, and a row with no `submittedAt` cannot be placed on
 * a time axis at all. The second one is dropped rather than stacked onto today, which would
 * draw a spike on a date nothing happened; Recent Submissions still lists the row.
 */
function receivedByDay(
  submissions: readonly Row[],
  timeZone: string,
  anchorKey: string,
): readonly DayCount[] {
  const counts = new Map<string, number>()
  for (const submission of submissions) {
    if (submission.status === 'draft' || submission.submittedAt === undefined) continue
    const key = dateKeyAt(submission.submittedAt, timeZone)
    if (key === undefined) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([dateKey, count]) => ({ dateKey, count, daysBefore: dayGap(dateKey, anchorKey) }))
    .sort((left, right) => right.daysBefore - left.daysBefore)
}

/**
 * A point at the window's start, one per day that received something, and one for today.
 *
 * Sparse on purpose: a point per calendar day would put 300 objects in the client payload
 * to describe a line that is flat between arrivals, and a step chart draws the same shape
 * from the days that changed. Days older than the window are folded into the first point's
 * value rather than dropped, so the line never restarts at zero mid-history.
 */
function seriesPoints(input: {
  days: readonly DayCount[]
  start: number
  end: number
  todayKey: string
  anchorKey: string
}): readonly PacingPoint[] {
  const { days, start, end, todayKey, anchorKey } = input
  const before = days.filter((day) => day.daysBefore > start)
  let cumulative = before.reduce((total, day) => total + day.count, 0)

  const points: PacingPoint[] = []
  if (!days.some((day) => day.daysBefore === start)) {
    points.push({ daysBefore: start, dateKey: keyDaysBefore(anchorKey, start), cumulative })
  }
  for (const day of days) {
    if (day.daysBefore > start || day.daysBefore < end) continue
    cumulative += day.count
    points.push({ daysBefore: day.daysBefore, dateKey: day.dateKey, cumulative })
  }
  if (points.at(-1)?.daysBefore !== end) {
    points.push({ daysBefore: end, dateKey: todayKey, cumulative })
  }
  return points
}

/**
 * Five evenly spaced ticks across the window, which is what produces ref 35's labels.
 *
 * The calendar label carries a year only when the tick falls outside the CURRENT year, and
 * that is a choice the reference cannot settle because it never shows Calendar date mode
 * turned on. A 365-day run-up crosses a new year, so `Oct 12` at the left end of the axis
 * and `Aug 8` at the right end would be eleven months apart while reading as one season.
 */
function axisTicks(input: {
  anchorKey: string
  todayKey: string
  start: number
  span: number
}): readonly PacingTick[] {
  const thisYear = input.todayKey.slice(0, 4)
  return Array.from({ length: TICK_COUNT }, (_, index) => {
    const daysBefore = wholeDays(input.start - (input.span * index) / (TICK_COUNT - 1))
    const dateKey = keyDaysBefore(input.anchorKey, daysBefore)
    return {
      daysBefore,
      minusLabel: tMinusLabel(daysBefore),
      dateLabel: formatAgendaDate(
        dateKey,
        dateKey.slice(0, 4) === thisYear
          ? { month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric', year: 'numeric' },
      ),
    }
  })
}

/**
 * A tick lands on a whole day, and a tick that falls exactly between two days rounds DOWN.
 *
 * Not a stylistic choice. The changelog screenshot of this card for an event 74 days out reads
 * `T-365d`, `T-292d`, `T-219d`, `T-147d`, `T-74d` (docs/parity/external-references.md), and its
 * middle tick sits at exactly 219.5 days: `Math.round` returns 220 there, which is the one
 * label of the five that would not match. Ref 35's own axis divides evenly and is unaffected.
 */
function wholeDays(value: number): number {
  return Math.ceil(value - 0.5)
}

/** `T-65d` before the anchor, `T+8d` after it. An event under way is a real state. */
function tMinusLabel(daysBefore: number): string {
  return daysBefore < 0 ? `T+${-daysBefore}d` : `T-${daysBefore}d`
}

function weekOverWeek(days: readonly DayCount[], end: number): number {
  const within = (day: DayCount, from: number, to: number) => {
    const ago = day.daysBefore - end
    return ago >= from && ago < to
  }
  const sum = (from: number, to: number) =>
    days.filter((day) => within(day, from, to)).reduce((total, day) => total + day.count, 0)
  return sum(0, 7) - sum(7, 14)
}

function emptyStats(end: number): PacingStats {
  return { submissions: 0, vsPriorLabel: `vs prior (${tMinusLabel(end)})`, thisWeekVsPrior: 0 }
}

/**
 * Whole days between two date keys. Calendar arithmetic on values that are ALREADY in the
 * event's timezone, so parsing them at UTC midnight is exact and DST cannot reach it: the
 * zone was applied when `dateKeyAt` produced the key.
 */
function dayGap(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS,
  )
}

/** The date key `days` days before `anchorKey`. Same calendar-space arithmetic. */
function keyDaysBefore(anchorKey: string, days: number): string {
  return new Date(Date.parse(`${anchorKey}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10)
}
