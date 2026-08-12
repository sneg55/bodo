// The New Dashboard gallery, ref 40: six template cards, and the widget set each one creates.
//
// Titles, descriptions, category chips and the order the cards appear in are transcribed off
// ref 40. Two descriptions are truncated in the screenshot by the card itself
// (`Event Overview` ends "and session..." and `Schedule Health` ends "and an..."), so their
// tails are authored and marked below; the other four are complete, two of them corroborated by
// the dashboards they instantiated in refs 38 and 39.
//
// **The widget count on a card is what instantiation actually creates**, and for three of the
// six that is fewer widgets than the reference claims. `WIDGET_METRICS` is a closed enum of
// eight aggregates over submissions, speakers and tasks (src/migrations/tables-cms.ts), and
// three cards describe things it cannot express: reviewer workload, session scores and
// top-rated sessions for `Review Progress`, scores per plan for `Evaluation Plans by Tracks`,
// and scheduled/unscheduled counts and per-day and per-room breakdowns for `Schedule Health`.
// Each of those templates therefore carries the widgets that ARE true for it and no filler, so
// a card reading "1 widget" is a card that creates one widget. Padding them with metrics their
// own description does not name would have been the dishonest option: an organizer would open a
// dashboard called Schedule Health and find submissions counted by track passed off as
// scheduling. The metrics that are missing are listed in docs/parity/dashboard.md.
//
// **A DESCRIPTION is held to the same standard as the widget count**, and two of them were not.
// The card's subtitle is also the dashboard's own description line (refs 38 and 39 render it
// under `CUSTOM DASHBOARD`), so a subtitle naming a widget the template cannot create is a
// promise the organizer reads twice: once before instantiating and once on the dashboard that
// does not have it. `Review Progress` promised reviewer workload, session scores and top-rated
// sessions, and `Speaker Tracking` promised an overdue list; none of the four exists and none
// can be added, because the enum has no reviewer, score or due-date aggregate in it. Both now
// describe the widgets they do create. That makes `Speaker Tracking` a recorded divergence from
// ref 38's transcribed line, and it is the same call this file already makes on the widget
// count: the card describes ours, not theirs.
//
// Note the two captured cards make the same claim in the other direction: ref 40 says
// "5 widgets" for both `Speaker Tracking` and `Submissions Pipeline`, and refs 38 and 39 then
// render four widgets each. Ours match the dashboards, not the cards.
//
// Pure and tested (tests/dashboards-templates.test.ts): a template is a list of enum values, so
// a typo is a widget Airtable rejects at the write, and the test is what catches that here
// rather than at instantiation.

import { widgetSpec } from '@/features/dashboard/widget-catalog'
import type { DashboardColor, WidgetMetric } from '@/services/airtable/mapping-dashboards'
import type { WidgetDraft } from '@/services/airtable/to-fields-dashboards'

/** Ref 40's chips. Uppercase as captured. */
export const TEMPLATE_CATEGORIES = [
  'OVERVIEW',
  'SUBMISSIONS',
  'SPEAKERS',
  'EVALUATION',
  'AGENDA',
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export type DashboardTemplate = {
  /** Stored in `Dashboards.templateKey`, so a tab can say where it came from. */
  key: string
  title: string
  description: string
  category: TemplateCategory
  /** The tab's dot. Refs 34 and 40 pair a colour with a template, see below. */
  color: DashboardColor
  /** In the order the widgets appear on the instantiated dashboard. */
  metrics: readonly WidgetMetric[]
}

export const DASHBOARD_TEMPLATES: readonly DashboardTemplate[] = [
  {
    key: 'event_overview',
    title: 'Event Overview',
    // Ref 40 truncates this at "and session..."; the tail is authored to name what the last
    // widget on our version actually shows.
    description:
      'KPIs at a glance: total submissions, accepted speakers, scheduled sessions, and session status.',
    category: 'OVERVIEW',
    color: 'green',
    metrics: [
      'total_submissions',
      'accepted_speakers',
      'pending_review',
      'submissions_by_track',
      'speaker_confirmation_mix',
    ],
  },
  {
    key: 'submissions_pipeline',
    title: 'Submissions Pipeline',
    // Ref 39's own description line, complete, arrow included.
    description:
      'Funnel of submissions from received → reviewed → accepted, with per-form and per-track context.',
    category: 'SUBMISSIONS',
    // Ref 34's `Submissions Pipeline` tab dot.
    color: 'purple',
    metrics: ['total_submissions', 'pending_review', 'submissions_by_form', 'submissions_by_track'],
  },
  {
    key: 'speaker_tracking',
    title: 'Speaker Tracking',
    // Ref 38's line reads "Confirmation status, outstanding tasks, and an overdue list for
    // accepted speakers." There is no overdue widget and no metric that could become one, so
    // the fourth clause names the top-N list that actually ships in its place. See the header.
    description:
      'Accepted speakers, confirmation status, outstanding tasks, and who is holding the most of them.',
    category: 'SPEAKERS',
    // Ref 34's `Speaker Tracking` tab dot.
    color: 'blue',
    metrics: [
      'accepted_speakers',
      'outstanding_speaker_tasks',
      'speaker_confirmation_mix',
      'top_speakers_by_outstanding_tasks',
    ],
  },
  {
    key: 'review_progress',
    title: 'Review Progress',
    // Ref 40's card promises reviewer workload, session scores and top-rated sessions as well.
    // The enum has none of the three, so the subtitle is the two widgets this creates. See the
    // header.
    description: 'Submissions still awaiting a decision, against every submission received.',
    category: 'EVALUATION',
    // Ref 34's `Review Progress` tab dot.
    color: 'orange',
    metrics: ['pending_review', 'total_submissions'],
  },
  {
    key: 'evaluation_plans_by_tracks',
    title: 'Evaluation Plans by Tracks',
    description: 'Compare Plan 2.0 session scores across tracks and evaluation plans.',
    category: 'EVALUATION',
    color: 'orange',
    // The track axis exists; scores per track and per plan do not. See the header.
    metrics: ['submissions_by_track'],
  },
  {
    key: 'schedule_health',
    title: 'Schedule Health',
    // Ref 40 truncates this at "and an..."; the tail is authored.
    description:
      'Scheduled vs unscheduled sessions, sessions per day/room/track, and an unscheduled list.',
    category: 'AGENDA',
    color: 'green',
    // Per-track is the only one of the three breakdowns the enum has. See the header.
    metrics: ['submissions_by_track'],
  },
]

export function dashboardTemplate(key: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((template) => template.key === key)
}

/**
 * The widget rows a template creates, in order.
 *
 * Titles and shapes come from `widget-catalog.ts` rather than being repeated per template, so
 * the same metric cannot end up titled two different things on two dashboards, and the eight
 * transcribed titles live in exactly one place.
 */
export function templateWidgets(
  template: DashboardTemplate,
): readonly Omit<WidgetDraft, 'dashboardId'>[] {
  return template.metrics.map((metric, index) => {
    const spec = widgetSpec(metric)
    return { title: spec.title, widgetType: spec.widgetType, metric, order: index }
  })
}
