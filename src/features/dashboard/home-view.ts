// The event home, as pure functions over data the DAL already returns.
//
// SPEC.md line 44 defers "dashboard analytics and charts" and every P2 item, and
// docs/parity/dashboard.md marks the whole surface P2 in the brief. So the pacing chart,
// the donuts, the stacked bars, the custom-dashboard widgets and the template gallery are
// all deliberately absent and should NOT be scored as missing.
//
// What is here instead is the part of ref 34 and ref 35 that is counts and links rather
// than charts: the day kicker, the KPI tiles, the submission-status tiles, the "Also
// check" advisory strip, the per-form progress row, and Recent Submissions. That is the
// difference between an event home an organizer can act on and the placeholder card this
// replaced, and none of it needs a charting library.
//
// Pure because every one of these is an off-by-one waiting to happen: a countdown that
// says 0 on the wrong side of midnight, a percentage over a zero denominator, a status
// tile that silently omits a status the lifecycle gained. Tested in
// tests/dashboard-home.test.ts.

import { SUBMISSION_STATUSES, type SubmissionStatus } from '@/constants/status'
import { dateKeyAt } from '@/features/agenda/time'
import type { Event, SubmissionWithParticipants } from '@/types/domain'
import { type Form, type FormPublicState, formPublicState } from '@/types/forms'

/** Statuses the SUBMISSION STATUS row shows, in ref 34's order. */
export const STATUS_TILE_ORDER: readonly SubmissionStatus[] = [
  'accepted',
  'pending',
  'declined',
  'draft',
  'withdrawn',
]

export type StatusTile = { status: SubmissionStatus; count: number }

/**
 * One tile per status in the captured order, then any status the lifecycle has that ref 34
 * did not show, so a new status cannot go uncounted just because the screenshot predates
 * it. `accept_queue` and `decline_queue` reach the tiles this way.
 */
export function statusTiles(
  submissions: readonly Pick<SubmissionWithParticipants, 'status'>[],
): readonly StatusTile[] {
  const counts = new Map<SubmissionStatus, number>(SUBMISSION_STATUSES.map((status) => [status, 0]))
  for (const submission of submissions) {
    counts.set(submission.status, (counts.get(submission.status) ?? 0) + 1)
  }

  const trailing = SUBMISSION_STATUSES.filter((status) => !STATUS_TILE_ORDER.includes(status))
  return [...STATUS_TILE_ORDER, ...trailing].map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }))
}

/**
 * Whole days from `now` to the event's first day, both read in the EVENT's timezone.
 *
 * In the timezone deliberately, and it is the reason this is not a subtraction: an
 * organizer in California looking at a Tokyo event should see the number of dates left on
 * the event's calendar, not a value that flips at their own midnight. `undefined` when the
 * event has no start date, so the caller omits the kicker rather than printing "NaN DAYS".
 * Negative is not clamped: an event that has started is a real state and the caller words
 * it, rather than this pretending the countdown is still running.
 */
export function daysToEvent(
  event: Pick<Event, 'startsAt' | 'timezone'>,
  now: Date,
): number | undefined {
  if (event.startsAt === undefined) return undefined
  const start = dateKeyAt(event.startsAt, event.timezone)
  const today = dateKeyAt(now.toISOString(), event.timezone)
  if (start === undefined || today === undefined) return undefined
  return Math.round(
    (Date.parse(`${start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
}

/** `SATURDAY, AUGUST 8 · 65 DAYS TO EVENT`, or just the date when there is no start. */
export function dayKicker(event: Pick<Event, 'startsAt' | 'timezone'>, now: Date): string {
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: safeZone(event.timezone),
  })
    .format(now)
    .toUpperCase()

  const days = daysToEvent(event, now)
  if (days === undefined) return date
  if (days > 1) return `${date} · ${days} DAYS TO EVENT`
  if (days === 1) return `${date} · 1 DAY TO EVENT`
  if (days < 0) return `${date} · EVENT STARTED`
  // On the day itself the calendar count cannot say whether it has begun, so the INSTANT
  // decides. It read "EVENT STARTS TODAY" all day, including hours after the opening session,
  // and the test encoded that wrong boundary. Found by Codex review.
  return started(event, now) ? `${date} · EVENT UNDER WAY` : `${date} · EVENT STARTS TODAY`
}

/** True once the event's own start instant has passed. Only consulted on the start date. */
function started(event: Pick<Event, 'startsAt'>, now: Date): boolean {
  if (event.startsAt === undefined) return false
  const at = Date.parse(event.startsAt)
  return !Number.isNaN(at) && now.getTime() >= at
}

/** `Good morning`, in the event's timezone for the same reason the countdown is. */
export function greeting(event: Pick<Event, 'timezone'>, now: Date, firstName?: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: safeZone(event.timezone),
    }).format(now),
  )
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const name = firstName?.trim() ?? ''
  return name.length === 0 ? part : `${part}, ${name}`
}

export type Advisory = { id: string; text: string; linkLabel: string; href: string }

/**
 * The "Also check" strip: things that are true right now and that an organizer can go and
 * fix, each with the link that fixes it.
 *
 * Only non-zero checks are returned, because an advisory reading "0 sessions need a time
 * slot" is noise dressed as a task. The caller decides how many to show and folds the rest
 * into "+N more", which is why this returns them all rather than slicing here.
 */
export function advisories(input: {
  submissions: readonly Pick<SubmissionWithParticipants, 'status' | 'startsAt' | 'scheduleStatus'>[]
  eventHref: (path: string) => string
}): readonly Advisory[] {
  const { submissions, eventHref } = input
  const found: Advisory[] = []

  const unslotted = submissions.filter(
    (row) => row.status === 'accepted' && row.startsAt === undefined,
  ).length
  if (unslotted > 0) {
    found.push({
      id: 'unslotted',
      text: `${unslotted} accepted ${plural(unslotted, 'session')} still ${plural(unslotted, 'needs', 'need')} a time slot on the agenda.`,
      linkLabel: 'Agenda',
      href: eventHref('/agenda'),
    })
  }

  const awaiting = submissions.filter((row) => row.status === 'pending').length
  if (awaiting > 0) {
    found.push({
      id: 'awaiting',
      text: `${awaiting} session ${plural(awaiting, 'submission')} ${plural(awaiting, 'is', 'are')} awaiting a decision.`,
      linkLabel: 'Abstracts',
      href: eventHref('/abstracts'),
    })
  }

  const staged = submissions.filter(
    (row) => row.status === 'accept_queue' || row.status === 'decline_queue',
  ).length
  if (staged > 0) {
    found.push({
      id: 'staged',
      text: `${staged} ${plural(staged, 'decision')} ${plural(staged, 'is', 'are')} staged and not yet sent.`,
      linkLabel: 'Abstracts',
      href: eventHref('/abstracts'),
    })
  }

  const scheduledUnpublished = submissions.filter(
    (row) => row.scheduleStatus === 'scheduled',
  ).length
  if (scheduledUnpublished > 0) {
    found.push({
      id: 'unpublished',
      text: `${scheduledUnpublished} scheduled ${plural(scheduledUnpublished, 'session')} ${plural(scheduledUnpublished, 'is', 'are')} not on the public agenda yet.`,
      linkLabel: 'Agenda',
      href: eventHref('/agenda'),
    })
  }

  return found
}

export type FormProgress = {
  id: string
  name: string
  /**
   * Derived, not the stored `status`. `formPublicState` already owns that rule and its
   * own comment says why conflating the two puts a draft on a public tab, so the badge on
   * these cards reads through it rather than re-deciding it here.
   */
  state: FormPublicState
  submitted: number
  /** Absent when the form has no close date, which is not the same as being closed. */
  closeDate?: string
  /** `Closes in a month` (ref 35), or absent when there is no close date. */
  closesLabel?: string
}

/**
 * Per-form submitted counts, and the aggregate the SUBMISSION PROGRESS bar shows.
 *
 * CFP forms only, filtered here rather than at the call site so no caller can forget.
 * `Form.kind` is `cfp | task` and `listForms` returns both, so a PORTAL form was appearing on
 * this row as a zero-submission card, inflating the aggregate denominator, linking Manage to
 * the submission-form editor, and offering a `/submit/...` link that is not a route for it.
 * Found by Codex review, and it was about to become visible: portal forms are being built now.
 */
export function formProgress(input: {
  /** CFP forms only. A portal form is a different thing: see the note below. */
  forms: readonly Form[]
  submissions: readonly Pick<SubmissionWithParticipants, 'formId' | 'status'>[]
  now: Date
}): { forms: readonly FormProgress[]; submitted: number; receiving: number } {
  const cfpForms = input.forms.filter((form) => form.kind === 'cfp')
  const byForm = new Map<string, number>()
  for (const submission of input.submissions) {
    if (submission.formId === undefined) continue
    // A DRAFT is not a submission, and counting one said "1 submitted" with a full progress
    // bar for a form nobody had actually submitted to. `list-view.ts` already draws this
    // line, and the two now agree. Found by Codex review.
    if (submission.status === 'draft') continue
    byForm.set(submission.formId, (byForm.get(submission.formId) ?? 0) + 1)
  }

  return {
    forms: cfpForms.map((form) => ({
      id: form.id,
      name: form.name,
      state: formPublicState(form, input.now),
      submitted: byForm.get(form.id) ?? 0,
      closeDate: form.closeDate,
      closesLabel: closesLabel(form.closeDate, input.now),
    })),
    // Counted off the forms, not off `submissions.length`: a submission an organizer
    // entered by hand has no form and belongs in neither the bar nor a card.
    submitted: [...byForm.values()].reduce((total, count) => total + count, 0),
    // How many forms have received anything. This is what the aggregate bar shows, and it
    // is chosen because it is the only real ratio available: no form carries a quota, so a
    // bar over a submission COUNT would need an invented denominator. The caption stays
    // the captured "N submitted" from ref 35, which is the count.
    receiving: cfpForms.filter((form) => (byForm.get(form.id) ?? 0) > 0).length,
  }
}

/**
 * Newest submissions first, capped.
 *
 * A submission with no `submittedAt` sorts last rather than being dropped, the same rule
 * the public agenda uses for a session with no start time: it is a data problem worth
 * showing an organizer, and hiding it makes the list look complete while a row is missing.
 */
export function recentSubmissions<T extends { submittedAt?: string }>(
  submissions: readonly T[],
  limit: number,
): readonly T[] {
  return submissions
    .toSorted((left, right) => stamp(right.submittedAt) - stamp(left.submittedAt))
    .slice(0, limit)
}

function stamp(value: string | undefined): number {
  if (value === undefined) return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * `Closes in a month`, `Closed 3 days ago`, using Intl.RelativeTimeFormat so the wording
 * comes from the platform rather than from a hand-rolled table of thresholds.
 *
 * Ref 35 shows the future case only. The past case is authored, and it is needed because a
 * form keeps its close date after it passes, and a card reading "Closes in 3 days ago"
 * would be worse than saying nothing.
 */
function closesLabel(closeDate: string | undefined, now: Date): string | undefined {
  if (closeDate === undefined) return undefined
  const at = Date.parse(closeDate)
  if (Number.isNaN(at)) return undefined

  // Tense comes from the actual comparison, not from the ROUNDED day count. A deadline that
  // passed less than half a day ago rounds to 0 and used to read "Closes today" next to a
  // Closed badge, because `formPublicState` flips the moment the instant passes. Found by
  // Codex review. The rounded value is still what gets worded, so the number and the tense
  // come from different places on purpose.
  const passed = at <= now.getTime()
  const days = Math.round((at - now.getTime()) / 86_400_000)
  const format = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  const unit = Math.abs(days) >= 30 ? 'month' : Math.abs(days) >= 7 ? 'week' : 'day'
  const divisor = unit === 'month' ? 30 : unit === 'week' ? 7 : 1
  const rounded = Math.round(days / divisor)
  // `numeric: 'auto'` turns 0 into "today", which reads wrong in the past tense, so a
  // just-passed deadline is worded explicitly rather than through the formatter.
  if (passed && rounded === 0) return 'Closed today'
  const relative = format.format(rounded, unit)

  return passed ? `Closed ${relative}` : `Closes ${relative}`
}

function plural(count: number, one: string, many?: string): string {
  if (count === 1) return one
  return many ?? `${one}s`
}

/**
 * `Events.timezone` is free text, so an unrecognised value would throw `RangeError` out of
 * `Intl` here exactly as it did across the agenda surfaces before `time.ts` guarded it.
 */
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}
