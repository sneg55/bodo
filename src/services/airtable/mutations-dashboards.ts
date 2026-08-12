// The custom dashboards' writes: instantiate a template, add a widget, save Settings, delete.
//
// TWO tags on almost every write, and which two is the whole point. The tab strip reads
// `event:{id}:dashboards` and a dashboard's grid reads `event:{id}:dashboard-widgets`, so a
// template instantiation names both (it creates a tab AND its widgets) while adding a widget
// names only the widgets tag: the strip did not change, and expiring it would make an organizer
// pay for the dashboard list again for nothing. Neither write names anything else, which is the
// property that matters here: adding a widget must not expire the agenda, the submissions list
// or the review graph, and it cannot, because it does not know their tags.
//
// A DELETE removes the widget rows first and the dashboard second. The other order leaves rows
// whose `dashboard` link points at nothing, and those rows are invisible to every read here
// (`listDashboardWidgets` keeps only widgets whose dashboard is in the event's list), so
// nothing would ever clean them up.
//
// No fixture branch, like every other mutation module: `getClient()` throws CFG_ENV_MISSING
// with no base configured, because a write that reports success and stores nothing leaves an
// organizer looking at a dashboard that will be empty again on reload.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { type Dashboard, mapDashboard } from '@/services/airtable/mapping-dashboards'
import { TABLES } from '@/services/airtable/tables'
import { eventDashboardsTag, eventDashboardWidgetsTag } from '@/services/airtable/tags-dashboards'
import {
  type DashboardDraft,
  type DashboardEdit,
  dashboardEditFields,
  dashboardFields,
  dashboardWidgetFields,
  type WidgetDraft,
  widgetOrderFields,
} from '@/services/airtable/to-fields-dashboards'
import type { RecordId } from '@/types/domain'

/** The strip's tag plus the grid's tag, for a write that changes both. */
function expireBoth(eventId: RecordId, origin: WriteOrigin): void {
  invalidate(origin, {
    own: [eventDashboardsTag(eventId), eventDashboardWidgetsTag(eventId)],
  })
}

/**
 * One dashboard and, in the same call, the widgets a template defines for it.
 *
 * The widgets are created here rather than by a second call from the action for one reason:
 * a template that created its tab and then failed to create its widgets would leave a tab in
 * the strip that renders an empty grid, and the organizer has no way to tell that from a
 * template that was supposed to be empty. Both halves land or the caller sees the failure.
 *
 * `widgets` may be empty, which is what "Build manually" would create.
 */
export async function createDashboard(
  draft: DashboardDraft,
  widgets: readonly Omit<WidgetDraft, 'dashboardId'>[],
  origin: WriteOrigin = 'action',
): Promise<Dashboard> {
  // The `finally` opens BEFORE the first write, not after it: a create that commits and then
  // fails to parse its own response has still changed the strip, and leaving the tag unexpired
  // there hides a tab that exists until the window lapses. Found by Codex review.
  try {
    const created = await getClient().createRecords(TABLES.dashboards, [dashboardFields(draft)])
    const record = created.at(0)
    if (record === undefined) {
      throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Dashboards: create returned no record', {
        table: TABLES.dashboards,
        name: draft.name,
      })
    }
    const dashboard = mapDashboard(record)
    if (widgets.length === 0) return dashboard

    try {
      // The client chunks at Airtable's batch ceiling of 10, so a five-widget template is one
      // request.
      await getClient().createRecords(
        TABLES.dashboardWidgets,
        widgets.map((widget) => dashboardWidgetFields({ ...widget, dashboardId: dashboard.id })),
      )
    } catch (error) {
      // Airtable has no transaction, so the tab is already there. Remove it, because the caller
      // is about to report a failure and a tab left in the strip would be an empty dashboard
      // the organizer did not ask for, indistinguishable from a template that has no widgets.
      // Retrying then creates a second one. A failed compensation is swallowed on purpose: the
      // original error is the one that explains what happened, and an orphaned empty tab an
      // organizer can delete is better than an error that names the cleanup instead of the cause.
      await removeQuietly(dashboard.id)
      throw error
    }
    return dashboard
  } finally {
    expireBoth(draft.eventId, origin)
  }
}

/** Best-effort rollback. See `createDashboard`: never masks the error that caused it. */
async function removeQuietly(dashboardId: RecordId): Promise<void> {
  try {
    await getClient().deleteRecords(TABLES.dashboards, [dashboardId])
  } catch {
    // Deliberately ignored.
  }
}

/**
 * "+ Add Widget", ref 38.
 *
 * `eventId` is a parameter and not read off the widget's dashboard, because the caller has
 * already verified that the dashboard belongs to this event (features/dashboard/authorize.ts).
 * Deriving it here from the row would authorize the invalidation against whatever the row says.
 */
export async function addDashboardWidget(
  target: { eventId: RecordId; draft: WidgetDraft },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().createRecords(TABLES.dashboardWidgets, [dashboardWidgetFields(target.draft)])
  } finally {
    // The grid's tag only: the strip has not changed. See the header.
    invalidate(origin, { own: [eventDashboardWidgetsTag(target.eventId)] })
  }
}

/**
 * The Settings dialog: the tab label, its dot colour, and the description line in one write.
 *
 * One write rather than one per control, for the same reason the embed editor's save is one
 * write: they are one form, and a per-field write would let the rename land while the colour
 * change failed, leaving an organizer looking at a dialog that agrees with neither.
 *
 * `finally` on the invalidation because a failed update can still have committed, and a cache
 * still holding the pre-write name is a tab strip that disagrees with the dashboard it opens.
 */
export async function updateDashboard(
  target: { eventId: RecordId; dashboardId: RecordId; edit: DashboardEdit },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().updateRecords(TABLES.dashboards, [
      { id: target.dashboardId, fields: dashboardEditFields(target.edit) },
    ])
  } finally {
    // The strip's tag only. A rename changes the tab, not what any widget counts.
    invalidate(origin, { own: [eventDashboardsTag(target.eventId)] })
  }
}

/**
 * Remove one widget from a dashboard.
 *
 * Until this existed, the only way off a dashboard was `deleteDashboard`, so an organizer who
 * added the wrong widget had to destroy the whole board to be rid of it.
 *
 * `eventId` is a parameter for the same reason `addDashboardWidget` takes one: the caller has
 * already checked that the widget's dashboard belongs to this event, and deriving the id from
 * the row here would authorize the invalidation against whatever the row happens to say.
 */
export async function removeDashboardWidget(
  target: { eventId: RecordId; widgetId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().deleteRecords(TABLES.dashboardWidgets, [target.widgetId])
  } finally {
    // The grid's tag only. Removing a widget does not change the tab strip.
    invalidate(origin, { own: [eventDashboardWidgetsTag(target.eventId)] })
  }
}

/**
 * Renumber a dashboard's widgets from 0, in the order given.
 *
 * Every row is rewritten rather than the two that swapped, which is `reorderPortals`' rule and
 * it is here for the same reason: a grid seeded from a template shares one order value across
 * several rows, so a move that only touched its neighbours would leave ties, and Airtable's own
 * sort leaves a tie however the page happened to come back. That is a widget that moves under
 * the organizer between refreshes.
 *
 * Only `order` is written (`widgetOrderFields`), so a move cannot revert a title an organizer
 * changed in another tab, and it cannot re-point a widget at the dashboard the client believed
 * it was on.
 */
export async function reorderDashboardWidgets(
  input: { eventId: RecordId; widgetIds: readonly RecordId[] },
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (input.widgetIds.length === 0) return

  const patches = input.widgetIds.map((id, index) => ({ id, fields: widgetOrderFields(index) }))
  try {
    await getClient().updateRecords(TABLES.dashboardWidgets, patches)
  } finally {
    invalidate(origin, { own: [eventDashboardWidgetsTag(input.eventId)] })
  }
}

/** Delete one dashboard and its widget rows. Widgets first: see the header. */
export async function deleteDashboard(
  target: { eventId: RecordId; dashboardId: RecordId; widgetIds: readonly RecordId[] },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    if (target.widgetIds.length > 0) {
      await getClient().deleteRecords(TABLES.dashboardWidgets, target.widgetIds)
    }
    await getClient().deleteRecords(TABLES.dashboards, [target.dashboardId])
  } finally {
    expireBoth(target.eventId, origin)
  }
}
