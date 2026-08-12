// The Dashboards and DashboardWidgets mappers, plus the two domain types they produce.
//
// The types live here rather than in src/types/cms.ts because that file belongs to the embed
// surface and is owned elsewhere this session; the vocabularies still come from
// src/migrations/tables-cms.ts, one way, exactly as `@/types/cms` imports EMBED_VIEWS. A
// second copy of a select's option list is the copy that drifts, and the one that drifts is
// always the one the migration was not written against: a value the app writes and Airtable
// rejects fails at the write, which is where an organizer cannot see what happened.
//
// **What our model is, against the real product.** Sessionboard's own widget create endpoint
// (`POST /v1/event/{eventId}/dashboards/{dashboardId}/widgets/create`) takes `type`, `title`,
// a free-form `config` object and a `query` string holding an SbQL query, so upstream a widget
// is a saved query plus a loose config blob, and upstream's `type` is a COARSE category
// (chart, table, number) with the specific chart kind living inside `config`. Ours is neither
// of those things: `metric` is a closed enum of eight fixed aggregates and `widgetType` is the
// concrete shape (stat, donut, bar, top_list), so our `widgetType` is finer-grained than
// theirs and our `metric` has no upstream counterpart at all. That is a deliberate
// simplification for a clone that only has to render the captured template widgets, and a
// stored query column would be an injection surface into this DAL. It is not a match for the
// reference and is not described as one.
//
// A row whose `widgetType` or `metric` is blank or unrecognised maps to `undefined` and is
// dropped by the read rather than throwing. Both are selects, so a blank one can only come
// from a row somebody made in Airtable directly, and there is no honest default: defaulting
// the metric would draw a number nobody asked for and defaulting the type would draw the
// wrong shape. Throwing would take a whole dashboard down over one hand-made row.

import { DASHBOARD_COLORS, WIDGET_METRICS, WIDGET_TYPES } from '@/migrations/tables-cms'
import {
  type AirtableRecord,
  choiceOr,
  numberOr,
  optionalText,
  type RecordView,
  requiredLink,
  text,
  view as viewOf,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import type { RecordId } from '@/types/domain'

export { DASHBOARD_COLORS, WIDGET_METRICS, WIDGET_TYPES }

export type DashboardColor = (typeof DASHBOARD_COLORS)[number]
export type WidgetType = (typeof WIDGET_TYPES)[number]
export type WidgetMetric = (typeof WIDGET_METRICS)[number]

export type Dashboard = {
  id: RecordId
  eventId: RecordId
  /** The tab label, ref 34's strip. */
  name: string
  /** The tab's dot, ref 34. */
  color: DashboardColor
  /** The line under `CUSTOM DASHBOARD`, refs 38 and 39. Absent renders no line. */
  description?: string
  /** Which gallery template instantiated it, or absent for one built by hand. */
  templateKey?: string
  order: number
}

export type DashboardWidget = {
  id: RecordId
  dashboardId: RecordId
  /** Rendered UPPERCASE by the card, refs 38 and 39. Stored as typed. */
  title: string
  widgetType: WidgetType
  metric: WidgetMetric
  order: number
}

export function mapDashboard(record: AirtableRecord): Dashboard {
  const source = viewOf(TABLES.dashboards, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    name: text(source, COL.name),
    // Ref 34's first custom tab is blue, so a colourless row still gets a dot rather than a
    // hole in the strip.
    color: choiceOr(source, COL.color, DASHBOARD_COLORS, 'blue'),
    ...optional('description', optionalText(source, COL.description)),
    ...optional('templateKey', optionalText(source, COL.templateKey)),
    // Zero, so a row with no order sorts first and stably rather than after everything by
    // accident. `dashboardTabs` breaks ties on name, so two zeroes still have one order.
    order: numberOr(source, COL.order, 0),
  }
}

/** `undefined` for a row whose type or metric cannot be read. See the header. */
export function mapDashboardWidget(record: AirtableRecord): DashboardWidget | undefined {
  const source = viewOf(TABLES.dashboardWidgets, record)
  const widgetType = oneOf(source, COL.widgetType, WIDGET_TYPES)
  const metric = oneOf(source, COL.metric, WIDGET_METRICS)
  if (widgetType === undefined || metric === undefined) return undefined

  return {
    id: source.id,
    dashboardId: requiredLink(source, COL.dashboard),
    title: text(source, COL.title),
    widgetType,
    metric,
    order: numberOr(source, COL.order, 0),
  }
}

/**
 * A select read against a closed list, where an unknown value is absent rather than fatal.
 *
 * `optionalChoice` in records.ts throws on a value outside the list, which is right for a
 * status an organizer set through the app. This is a widget shape: a new option typed into
 * the Airtable select by hand is a widget this build cannot draw, and the honest answer is to
 * leave it out of the grid rather than to take the dashboard to an error boundary.
 */
function oneOf<T extends string>(
  source: RecordView,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const raw = optionalText(source, field)
  return allowed.find((option) => option === raw)
}

/** Spreads a key only when it has a value, since both are optional properties. */
function optional<K extends string>(key: K, value: string | undefined): Record<K, string> | object {
  return value === undefined ? {} : { [key]: value }
}
