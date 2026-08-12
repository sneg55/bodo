// What a custom dashboard reads, and deliberately what it does not.
//
// Composition over the DAL and nothing else: every call below is already tagged and cached
// where the fetch happens (read-cache.ts), so this file adds no caching of its own and must not.
//
// **The widget set decides the reads.** A dashboard holding two stat widgets over submissions
// issues two reads (`Dashboards` and `DashboardWidgets`) plus `listSubmissions`, and subscribes
// to `event:{id}:submissions` and nothing else. Only `SUBMISSIONS BY FORM` pulls in
// `event:{id}:forms`, only `SUBMISSIONS BY TRACK` pulls in `event:{id}:lookups`, and only the
// three task widgets pull in `event:{id}:tasks`. Reading all four unconditionally would
// subscribe the Speaker Tracking dashboard to the form list and the track names, so renaming a
// track would expire a screen that cannot show one. That is the same reasoning home-reads.ts
// gives for reading per sub-tab.

import type { Dashboard, DashboardWidget } from '@/services/airtable/mapping-dashboards'
import {
  getEvent,
  listForms,
  listSubmissions,
  listTaskAssignmentsForEvent,
  listTracks,
} from '@/services/airtable/queries'
import { listDashboards, listDashboardWidgets } from '@/services/airtable/reads-dashboards'
import type { Event, RecordId } from '@/types/domain'

import { type DashboardTab, dashboardTabBySlug, dashboardTabs } from './dashboard-tabs'
import { byWidgetOrder } from './widget-order'
import { type WidgetInputs, type WidgetView, widgetView } from './widget-views'

export type WidgetCell = { widget: DashboardWidget; view: WidgetView }

export type CustomDashboardView = {
  /** For the shared page header, which is chrome above the strip on refs 38 and 39. */
  event: Event
  dashboard: Dashboard
  tabs: readonly DashboardTab[]
  cells: readonly WidgetCell[]
}

/** The strip, for the Today dashboard and for a custom one alike. */
export async function loadDashboardTabs(eventId: RecordId): Promise<readonly DashboardTab[]> {
  return dashboardTabs(eventId, await listDashboards(eventId))
}

/**
 * One custom dashboard by its URL slug, with its widgets already computed.
 *
 * `undefined` for an unknown slug, so the page BODY can call `notFound()` itself. It must not be
 * called from here: this runs inside the page's render, and a `notFound()` reached from under a
 * Suspense boundary answers HTTP 200 with the 404 body on Workers.
 */
export async function loadCustomDashboard(
  eventId: RecordId,
  slug: string,
): Promise<CustomDashboardView | undefined> {
  // In parallel: the header needs the event and the strip needs the list, and neither depends
  // on the other. `event:{id}` is a tag this page is subscribed to through the header anyway.
  const [event, dashboards] = await Promise.all([getEvent(eventId), listDashboards(eventId)])
  const tabs = dashboardTabs(eventId, dashboards)
  const tab = dashboardTabBySlug(tabs, slug)
  const dashboard = dashboards.find((row) => row.id === tab?.dashboardId)
  if (dashboard === undefined) return undefined

  const all = await listDashboardWidgets(
    eventId,
    dashboards.map((row) => row.id),
  )
  // Ties break on record id, so a grid whose widgets share an `order` renders in the same
  // sequence on every request. Two adds racing each other both read the same highest order
  // (actions.ts), and Airtable's own sort leaves the tie however the page happened to come back,
  // which would move a widget under the organizer between refreshes. Found by Codex review.
  const widgets = all
    .filter((widget) => widget.dashboardId === dashboard.id)
    .toSorted(byWidgetOrder)
  const inputs = await loadWidgetInputs(eventId, widgets)

  return {
    event,
    dashboard,
    tabs,
    cells: widgets.map((widget) => ({ widget, view: widgetView(widget.metric, inputs) })),
  }
}

/** The reads this dashboard's widgets actually need. See the header. */
async function loadWidgetInputs(
  eventId: RecordId,
  widgets: readonly DashboardWidget[],
): Promise<WidgetInputs> {
  const metrics = new Set(widgets.map((widget) => widget.metric))
  const wantsForms = metrics.has('submissions_by_form')
  const wantsTracks = metrics.has('submissions_by_track')
  const wantsTasks =
    metrics.has('outstanding_speaker_tasks') ||
    metrics.has('speaker_confirmation_mix') ||
    metrics.has('top_speakers_by_outstanding_tasks')
  // Every metric except the three task ones counts submissions, and the top-N list needs the
  // cast for its speaker names, so this is "anything at all except a tasks-only dashboard".
  const wantsSubmissions = [...metrics].some((metric) => metric !== 'outstanding_speaker_tasks')

  const [submissions, forms, tracks, tasks] = await Promise.all([
    wantsSubmissions ? listSubmissions(eventId) : [],
    wantsForms ? listForms(eventId) : [],
    wantsTracks ? listTracks(eventId) : [],
    wantsTasks ? listTaskAssignmentsForEvent(eventId) : [],
  ])

  return {
    submissions: submissions.map((submission) => ({
      status: submission.status,
      ...(submission.formId === undefined ? {} : { formId: submission.formId }),
      ...(submission.trackId === undefined ? {} : { trackId: submission.trackId }),
      participants: submission.participants.map((participant) => ({
        speakerId: participant.speakerId,
        role: participant.role,
        name: `${participant.speaker.firstName} ${participant.speaker.lastName}`.trim(),
      })),
    })),
    forms: forms.map((form) => ({ id: form.id, name: form.name })),
    tracks: tracks.map((track) => ({ id: track.id, name: track.name })),
    tasks: tasks.map((item) => ({
      speakerId: item.assignment.speakerId,
      status: item.assignment.status,
      kind: item.task.kind,
    })),
  }
}
