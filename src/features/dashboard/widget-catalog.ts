// The eight widgets this build can draw: their captured titles and the shape each one takes.
//
// `WIDGET_METRICS` is a closed enum on the Airtable select (src/migrations/tables-cms.ts) and
// this is the one table that says what each value MEANS. Every title here is transcribed: all
// eight appear on screen in refs 38 and 39 (`ACCEPTED SPEAKERS`, `OUTSTANDING SPEAKER TASKS`,
// `SPEAKER CONFIRMATION MIX`, `TOP SPEAKERS BY OUTSTANDING TASKS`, `TOTAL SUBMISSIONS`,
// `PENDING REVIEW`, `SUBMISSIONS BY FORM`, `SUBMISSIONS BY TRACK`). They are stored in the
// case written here and rendered uppercase by the card, because uppercase is how the reference
// PRESENTS a widget title, not how an organizer typed it.
//
// **The metric decides the shape.** `widgetType` is a column of its own, so a row can disagree
// with its metric, and when it does the metric wins at render time: there is nothing for a
// donut to draw around a single number, so honouring a mismatched column would produce an
// empty card instead of the number the organizer asked for. The type stored on creation is
// the one named here.
//
// A Map rather than an object indexed by a variable key: `security/detect-object-injection`
// warns on the latter and lint runs at zero warnings. The map is exhaustive over the union, so
// the `??` fallbacks at the call sites are a type requirement rather than a reachable branch.

import type { WidgetMetric, WidgetType } from '@/services/airtable/mapping-dashboards'

export type WidgetSpec = {
  metric: WidgetMetric
  /** Transcribed off refs 38 and 39. Rendered uppercase. */
  title: string
  widgetType: WidgetType
  /**
   * What the number counts, for the Add Widget gallery card. Authored, because the reference's
   * Add Widget gallery is one of the surfaces our screenshots never captured
   * (docs/parity/external-references.md, "Still uncaptured").
   */
  summary: string
}

const CATALOG: readonly WidgetSpec[] = [
  {
    metric: 'accepted_speakers',
    title: 'Accepted Speakers',
    widgetType: 'stat',
    summary: 'Distinct people on an accepted submission.',
  },
  {
    metric: 'outstanding_speaker_tasks',
    title: 'Outstanding Speaker Tasks',
    widgetType: 'stat',
    summary: 'Portal tasks assigned and not yet done.',
  },
  {
    metric: 'speaker_confirmation_mix',
    title: 'Speaker Confirmation Mix',
    widgetType: 'donut',
    // Names the sense, because "confirmed" means three different things across this build and
    // the gallery card is where an organizer decides whether this is the one they want. Not the
    // roster's `Speaker status`, and not a session being accepted. See `confirmationMix`.
    summary: 'Portal confirmation tasks done, over everyone sent one. Not the roster status.',
  },
  {
    metric: 'top_speakers_by_outstanding_tasks',
    title: 'Top Speakers by Outstanding Tasks',
    widgetType: 'top_list',
    summary: 'The speakers with the most tasks still open.',
  },
  {
    metric: 'total_submissions',
    title: 'Total Submissions',
    widgetType: 'stat',
    summary: 'Every submission on the event, drafts included.',
  },
  {
    metric: 'pending_review',
    title: 'Pending Review',
    widgetType: 'stat',
    summary: 'Submissions awaiting a decision.',
  },
  {
    metric: 'submissions_by_form',
    title: 'Submissions by Form',
    widgetType: 'bar',
    summary: 'One bar per submission form, plus (none) for the rest.',
  },
  {
    metric: 'submissions_by_track',
    title: 'Submissions by Track',
    widgetType: 'bar',
    summary: 'One bar per track, plus (none) for the untracked.',
  },
]

const BY_METRIC = new Map(CATALOG.map((spec) => [spec.metric, spec]))

/** Gallery order, which is the order the two captured dashboards introduce them in. */
export const WIDGET_CATALOG = CATALOG

export function widgetSpec(metric: WidgetMetric): WidgetSpec {
  // Exhaustive by construction; the fallback exists so the return type is not optional.
  return BY_METRIC.get(metric) ?? CATALOG[0]
}
