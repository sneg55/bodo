// Reads for Dashboards and DashboardWidgets: the tab strip, one custom dashboard's grid, and
// the uncached row the write path authorizes against.
//
// Both list reads filter in code, for the reason at the top of reads.ts: an Airtable formula
// sees a linked record as its primary field's TEXT, so `{event} = 'recABC'` matches nothing at
// all and `{event} = 'AI Engineer Sandbox'` starts matching nothing the day someone renames
// the event. Both carry their tags into the Data Cache, so the pages are paid for once per
// invalidation rather than once per request.
//
// `getDashboard` is NOT cached, exactly like `getCmsEmbed`: it is what a mutation uses to
// check that a posted record id belongs to the event the caller was authorized for, and a
// cached answer there authorizes against a row's old event link.
//
// **The `hasAirtable()` guard is the fixture branch.** Every other read reaches Airtable
// through `getSource()`, which serves fixtures on a clone with an empty `.env`; that port
// (data-source.ts, source.ts, queries.ts) is owned elsewhere this session, so these reads call
// the client directly and answer the no-base case themselves. Empty is the truthful answer:
// with no base there are no custom dashboards, the strip is `Today` alone, and the event home
// still renders. Without the guard `getClient()` would throw CFG_ENV_MISSING and take the
// landing page down on a fresh clone, which is exactly what the fixture branch exists to
// prevent.

import { getClient } from '@/services/airtable/client'
import {
  type Dashboard,
  type DashboardWidget,
  mapDashboard,
  mapDashboardWidget,
} from '@/services/airtable/mapping-dashboards'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { byOrder } from '@/services/airtable/reads'
import { numberOr, optionalLink, optionalText, view as viewOf } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventDashboardsTag, eventDashboardWidgetsTag } from '@/services/airtable/tags-dashboards'
import type { RecordId } from '@/types/domain'
import { hasAirtable } from '@/utils/env'

/** Every custom dashboard on the event, in `order`. `Today` is not one of them. */
export async function listDashboards(eventId: string): Promise<readonly Dashboard[]> {
  if (!hasAirtable()) return []
  const records = await getClient().listAll(TABLES.dashboards, {
    sort: byOrder,
    tags: [eventDashboardsTag(eventId)],
    revalidate: REVALIDATE.edited,
  })
  return records.map(mapDashboard).filter((dashboard) => dashboard.eventId === eventId)
}

/**
 * The widgets of the given dashboards, in `order`.
 *
 * Takes the dashboard ids rather than deriving them, because `DashboardWidgets.dashboard` is
 * the only link on the row: there is no event column to filter on, so the caller's already
 * loaded dashboard list IS the event scope. `eventId` is here for the tag, which is
 * event-wide on purpose (tags-dashboards.ts explains why it cannot be per dashboard).
 */
export async function listDashboardWidgets(
  eventId: string,
  dashboardIds: readonly string[],
): Promise<readonly DashboardWidget[]> {
  if (!hasAirtable() || dashboardIds.length === 0) return []
  const keep = new Set(dashboardIds)
  const records = await getClient().listAll(TABLES.dashboardWidgets, {
    sort: byOrder,
    tags: [eventDashboardWidgetsTag(eventId)],
    revalidate: REVALIDATE.edited,
  })
  return records.flatMap((record) => {
    const widget = mapDashboardWidget(record)
    // An unreadable row is dropped by the mapper; one belonging to another event's dashboard
    // is dropped here. Neither is an error: this table is the whole base's widgets.
    return widget !== undefined && keep.has(widget.dashboardId) ? [widget] : []
  })
}

/** One dashboard by record id, uncached, for the write path. See the header. */
export async function getDashboard(dashboardId: string): Promise<Dashboard> {
  return mapDashboard(await getClient().getRecord(TABLES.dashboards, dashboardId))
}

/** Only what the write path decides from: which rows to delete, and the next `order`. */
/**
 * `metric` is the RAW cell, so it is a string the enum may not contain, or absent. That is the
 * point of it being here rather than on the mapped row: the add path refuses a metric a
 * dashboard already carries, and a row the mapper drops still occupies that metric.
 */
export type WidgetRow = { id: RecordId; order: number; metric: string | undefined }

/**
 * One dashboard's widget rows, uncached and UNMAPPED, for the write path.
 *
 * Uncached deliberately, and it is the same reason the speaker upsert reads uncached: both
 * writers decide something FROM this answer and a cached one is missing whatever was added since
 * it was populated. A delete decides which rows to remove, and a row it misses survives its
 * dashboard where no cached read can ever see it again (`listDashboardWidgets` keeps only
 * widgets whose dashboard is still in the event's list). An add decides the next `order`, and a
 * stale count gives two widgets the same one.
 *
 * Unmapped for a related reason, and it is why this does not go through `mapDashboardWidget`.
 * That mapper answers `undefined` for a row whose `widgetType` or `metric` is blank or
 * unrecognised, which is right for the grid (draw nothing rather than the wrong shape) and wrong
 * for both writers here. A delete built from the mapped list leaves those rows behind pointing
 * at a dashboard that no longer exists, and nothing will ever see them again to clean them up.
 * An `order` computed from the mapped list cannot see the order an unreadable row already holds.
 * Deleting a row and counting a row need the `dashboard` link and nothing else, so this reads
 * exactly that. Found by Codex review.
 */
export async function listWidgetRowsUncached(dashboardId: string): Promise<readonly WidgetRow[]> {
  const records = await getClient().listAll(TABLES.dashboardWidgets)
  return records.flatMap((record) => {
    const source = viewOf(TABLES.dashboardWidgets, record)
    if (optionalLink(source, COL.dashboard) !== dashboardId) return []
    return [
      {
        id: source.id,
        order: numberOr(source, COL.order, 0),
        metric: optionalText(source, COL.metric),
      },
    ]
  })
}
