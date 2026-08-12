// App input to an Airtable field set, for Dashboards and DashboardWidgets.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one id, and
// an ABSENT key leaves the old value in place. Three decisions follow from that here.
//
// The dashboard create always sends `order`, because the tab strip is ordered and a row with no
// order would sort ahead of everything the organizer created before it (`mapDashboard`
// defaults a blank one to 0).
//
// The dashboard EDIT does not send the event link or `templateKey`. A dashboard does not change
// events, and `templateKey` records which gallery card instantiated it: re-sending it on every
// save would let a rename quietly relabel where the dashboard came from, which is the one thing
// that column is for. `description` IS sent even when empty, as an empty string, because
// clearing the description line is a thing the Settings dialog has to be able to do and an
// absent key would silently keep the old text.
//
// A widget draft carries no event link, because DashboardWidgets has none: a widget's event is
// its dashboard's event, and that is also why every mutation authorizes through the dashboard.

import type { Dashboard, DashboardWidget } from '@/services/airtable/mapping-dashboards'
import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

export type DashboardDraft = {
  eventId: RecordId
  name: string
  color: Dashboard['color']
  description?: string
  /** The gallery card this came from, absent for a dashboard built by hand. */
  templateKey?: string
  order: number
}

export function dashboardFields(draft: DashboardDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.color]: draft.color,
    [COL.description]: draft.description,
    [COL.templateKey]: draft.templateKey,
    [COL.order]: draft.order,
  })
}

/** What the Settings dialog may change: the tab label, its dot, and the description line. */
export type DashboardEdit = {
  name: string
  color: Dashboard['color']
  /** Empty string clears the line. See the header. */
  description: string
}

export function dashboardEditFields(edit: DashboardEdit): FieldSet {
  return {
    [COL.name]: edit.name,
    [COL.color]: edit.color,
    [COL.description]: edit.description,
  }
}

export type WidgetDraft = {
  dashboardId: RecordId
  title: string
  widgetType: DashboardWidget['widgetType']
  metric: DashboardWidget['metric']
  order: number
}

export function dashboardWidgetFields(draft: WidgetDraft): FieldSet {
  return compact({
    [COL.title]: draft.title,
    [COL.dashboard]: link(draft.dashboardId),
    [COL.widgetType]: draft.widgetType,
    [COL.metric]: draft.metric,
    [COL.order]: draft.order,
  })
}

/**
 * One row of a widget reorder: the new position and nothing else.
 *
 * Separate from `dashboardWidgetFields` rather than a call to it, for the reason
 * `portalOrderFields` is separate from `portalUpdateFields`. Re-sending the dashboard link,
 * the metric and the widget type on a move would make the reorder a lost update: the row
 * would be rewritten from whatever the browser last read, so a move reverts anything changed
 * since, and it would silently re-link a widget to the dashboard the client thinks it is on.
 */
export function widgetOrderFields(order: number): FieldSet {
  return { [COL.order]: order }
}
