// What each of the eight widget metrics actually counts. Refs 38 and 39.
//
// Pure and tested (tests/dashboards-widgets.test.ts). Every widget on this surface is a number
// an organizer would act on, and none of them is checkable by looking at the card: a bar
// labelled `(none)` reading 2 looks equally correct whether or not the untracked rows landed in
// it. The traps that are actually tested are the `(none)` bucket, the top-N ordering, and the
// difference between a widget that counts 0 and a widget with nothing to draw.
//
// **A stat is never "No data".** Ref 38 shows big `0` under `ACCEPTED SPEAKERS`, so zero is a
// legitimate reading of a number. A donut, a bar chart and a top-N list with nothing in them
// have no shape at all, and those are the three that ref 38 and ref 39 render as `No data`.
//
// Grain decisions the reference cannot settle, stated rather than hidden:
//
//   - `TOTAL SUBMISSIONS` counts every submission, which is the same grain as ref 34's
//     `Submissions` KPI tile. Ref 39's widget reads 2 on the same event whose tile reads 4, so
//     the reference's own two screens disagree; that inconsistency is deliberately not
//     reproduced, the same call `status-mix.ts` already made about ref 36's donut.
//   - `OUTSTANDING SPEAKER TASKS` counts ASSIGNMENTS, not people, so one speaker with three
//     open tasks is three. That is what the title says and it is what the top-N list beside it
//     ranks by.
//   - `SPEAKER CONFIRMATION MIX` is over everyone who has been ASKED to confirm, meaning a
//     speaker holding a `confirm` task, and not over accepted speakers. The ask is the thing
//     that puts somebody in the mix: an accepted speaker nobody has asked is not unconfirmed,
//     they are unasked, and counting them as unconfirmed would make the widget read worse the
//     more speakers an organizer accepts. With nobody asked the widget is `No data`, which is
//     exactly the state ref 38 captures.

import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import { acceptedSpeakerCount } from '@/features/dashboard/roles'
import type { WidgetMetric } from '@/services/airtable/mapping-dashboards'

/** Ref 39's x-axis label for the submissions with no form. Also used for a missing track. */
export const NO_BUCKET_LABEL = '(none)'

/** How many rows a top-N list shows. Ref 40's thumbnail lists six names. */
export const TOP_LIST_SIZE = 6

/** Ref 39's y axis: five ticks, the maximum down to zero in quarters. */
const TICK_FRACTIONS = [1, 0.75, 0.5, 0.25, 0]

export type BarTick = { fraction: number; label: string }

/**
 * The five y-axis ticks for a bar chart whose tallest bar is `max`.
 *
 * Derived from the data rather than rounded to friendly numbers, because that is what ref 39
 * shows: `2, 1.5, 1, 0.5, 0` on a chart topping out at 2, and `1, .75, 0.5, .25, 0` on one
 * topping out at 1. Both are quarters of the maximum.
 *
 * Plain arithmetic rather than `Intl.NumberFormat`: Workers run `Intl` in a fixed locale and a
 * thousands separator has no business on an axis, and `0.7500000000000001` is what unguarded
 * floating point puts there.
 */
export function barTicks(max: number): readonly BarTick[] {
  return TICK_FRACTIONS.map((fraction) => {
    const value = Math.round(max * fraction * 100) / 100
    return {
      fraction,
      label: Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/u, ''),
    }
  })
}

export type WidgetParticipant = { speakerId: string; role: ParticipantRole; name: string }

export type WidgetSubmission = {
  status: SubmissionStatus
  formId?: string
  trackId?: string
  participants: readonly WidgetParticipant[]
}

/** One task assignment, flattened to the three fields any widget here reads. */
export type WidgetTask = {
  speakerId: string
  status: 'pending' | 'done'
  kind: 'upload' | 'form' | 'link' | 'confirm'
}

export type WidgetInputs = {
  submissions: readonly WidgetSubmission[]
  /** In list order, which is the order the bars come out in. */
  forms: readonly { id: string; name: string }[]
  tracks: readonly { id: string; name: string }[]
  tasks: readonly WidgetTask[]
}

export type WidgetRow = { id: string; label: string; value: number }

export type WidgetView =
  | { kind: 'stat'; value: number }
  | { kind: 'donut'; slices: readonly WidgetRow[]; centreValue: number; centreCaption: string }
  | { kind: 'bar'; bars: readonly WidgetRow[] }
  | { kind: 'top_list'; rows: readonly WidgetRow[] }
  /** Ref 38's `No data`, rendered inside an otherwise normal widget card. */
  | { kind: 'empty' }

export function widgetView(metric: WidgetMetric, inputs: WidgetInputs): WidgetView {
  switch (metric) {
    case 'accepted_speakers':
      return { kind: 'stat', value: acceptedSpeakerCount(inputs.submissions) }
    case 'outstanding_speaker_tasks':
      return { kind: 'stat', value: openTasks(inputs.tasks).length }
    case 'speaker_confirmation_mix':
      return confirmationMix(inputs.tasks)
    case 'top_speakers_by_outstanding_tasks':
      return topSpeakers(inputs)
    case 'total_submissions':
      return { kind: 'stat', value: inputs.submissions.length }
    case 'pending_review':
      return {
        kind: 'stat',
        value: inputs.submissions.filter((row) => row.status === 'pending').length,
      }
    case 'submissions_by_form':
      return bars(inputs.submissions, inputs.forms, (row) => row.formId)
    case 'submissions_by_track':
      return bars(inputs.submissions, inputs.tracks, (row) => row.trackId)
  }
}

function openTasks(tasks: readonly WidgetTask[]): readonly WidgetTask[] {
  return tasks.filter((task) => task.status === 'pending')
}

/**
 * Confirmation TASKS done against outstanding, over the speakers holding a `confirm` task.
 *
 * A speaker with several confirm tasks (one per accepted talk, say) counts ONCE, and counts as
 * confirmed if any of them is done. The alternative reads a speaker who confirmed one talk and
 * not another as both confirmed and unconfirmed, which would make the slices sum past the
 * number of people they describe.
 *
 * **The slices say which "confirmed" this is, and that is the whole reason they are worded the
 * way they are.** Three different senses of the word meet across this build: the roster's
 * `Speaker status`, which is the organizer's own record of whether somebody is coming; a
 * session being accepted; and this, the portal task the speaker completed themselves. They move
 * independently, so this widget can read 4 while the roster's Confirmed tab reads 0 with
 * neither being wrong, and bare `Confirmed` on the legend invited an organizer to read one as
 * the other. The roster now heads both its strip and its column `Speaker status` with a tooltip
 * separating the three (`SPEAKER_STATUS_HELP`); this is the same fix on this side of the
 * collision. The widget TITLE is untouched, because `SPEAKER CONFIRMATION MIX` is transcribed
 * off ref 38 and the legend is not.
 */
function confirmationMix(tasks: readonly WidgetTask[]): WidgetView {
  const asked = new Map<string, boolean>()
  for (const task of tasks) {
    if (task.kind !== 'confirm') continue
    asked.set(task.speakerId, (asked.get(task.speakerId) ?? false) || task.status === 'done')
  }

  const confirmed = [...asked.values()].filter(Boolean).length
  const unconfirmed = asked.size - confirmed
  if (asked.size === 0) return { kind: 'empty' }

  return {
    kind: 'donut',
    slices: [
      { id: 'confirmed', label: 'Confirmation task done', value: confirmed },
      { id: 'unconfirmed', label: 'Confirmation task outstanding', value: unconfirmed },
    ],
    centreValue: confirmed,
    // `outstanding` rather than `open` throughout, because that is the word the widget beside
    // this one already uses for a task nobody has done (`OUTSTANDING SPEAKER TASKS`).
    centreCaption: 'tasks done',
  }
}

/**
 * The speakers with the most open tasks, highest first, capped at `TOP_LIST_SIZE`.
 *
 * Names come from the submission cast, which is already loaded with its speakers attached, so
 * this costs no extra read. An assignment whose speaker is on no submission of this event still
 * appears, labelled `(none)`: it is counted by `OUTSTANDING SPEAKER TASKS` beside it, and
 * dropping it here would make the two widgets disagree with no way to see why.
 *
 * Ties break on the label so the list does not reshuffle between requests.
 */
function topSpeakers(inputs: WidgetInputs): WidgetView {
  const names = new Map<string, string>()
  for (const submission of inputs.submissions) {
    for (const participant of submission.participants) {
      names.set(participant.speakerId, participant.name)
    }
  }

  const counts = new Map<string, number>()
  for (const task of openTasks(inputs.tasks)) {
    counts.set(task.speakerId, (counts.get(task.speakerId) ?? 0) + 1)
  }

  const rows = [...counts.entries()]
    .map(([speakerId, value]) => ({
      id: speakerId,
      label: names.get(speakerId) ?? NO_BUCKET_LABEL,
      value,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, TOP_LIST_SIZE)

  return rows.length === 0 ? { kind: 'empty' } : { kind: 'top_list', rows }
}

/**
 * One bar per named bucket that has at least one submission, then `(none)` last.
 *
 * Empty buckets are left out rather than drawn at zero, which is what ref 39 shows: its
 * `SUBMISSIONS BY FORM` chart has a single bar on an event holding three forms. `(none)` goes
 * last because it is not a form or a track, it is the absence of one, and a category axis that
 * sorts it in among the real names invites reading it as one.
 */
function bars(
  submissions: readonly WidgetSubmission[],
  buckets: readonly { id: string; name: string }[],
  keyOf: (submission: WidgetSubmission) => string | undefined,
): WidgetView {
  const counts = new Map<string, number>()
  let none = 0
  for (const submission of submissions) {
    const key = keyOf(submission)
    if (key === undefined) {
      none += 1
      continue
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const named = buckets.flatMap((bucket) => {
    const value = counts.get(bucket.id) ?? 0
    return value === 0 ? [] : [{ id: bucket.id, label: bucket.name, value }]
  })

  // A submission pointing at a form or track that is not in the event's list: kept, because the
  // row exists and the total has to account for it, and labelled as the absence it looks like
  // from here. `listForms` and `listTracks` are the whole list, so this is a deleted lookup.
  const orphans = [...counts.entries()]
    .filter(([id]) => !buckets.some((bucket) => bucket.id === id))
    .reduce((sum, [, value]) => sum + value, 0)

  const unbucketed = none + orphans
  const rows =
    unbucketed === 0 ? named : [...named, { id: 'none', label: NO_BUCKET_LABEL, value: unbucketed }]

  return rows.length === 0 ? { kind: 'empty' } : { kind: 'bar', bars: rows }
}
