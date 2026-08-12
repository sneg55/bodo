'use server'

// The custom dashboards' writes: instantiate a template, add a widget, remove one, move one,
// save Settings, delete.
//
// The order below is the security property and not a style, and it is the same order
// @/features/cms/actions uses:
//
//   1. `requireEventRole(eventId, 'admin')`. Capability comes from EventMemberships on every
//      call, never from the session cookie, so removing somebody from the event takes effect on
//      their next request.
//   2. `ownedDashboard`, which loads the row uncached and checks its event link (./authorize).
//   3. Validate the posted values against the closed vocabularies.
//   4. Write, and let the DAL expire exactly the tags that write touched.
//
// Step 1 is here and not only in `(admin)/admin/[eventId]/layout.tsx` because a Server Action is
// reachable by POST without any layout ever rendering (BUILD_SPEC 4).
//
// Every action hands back an `href` rather than calling `redirect()` itself. `redirect()` from a
// Server Action would work, but the caller is a client component inside a page that is itself
// under a Suspense boundary, and keeping navigation on the client side means the one rule this
// route cannot break (never redirect or 404 from under a boundary) is not something a future
// edit here can accidentally undo.

import { requireEventRole } from '@/features/auth/wiring'
import { cut, type DashboardActionResult, failure } from '@/features/dashboard/action-result'
import { ownedDashboard } from '@/features/dashboard/authorize'
import { dashboardTabs } from '@/features/dashboard/dashboard-tabs'
import { dashboardTemplate, templateWidgets } from '@/features/dashboard/dashboard-templates'
import { widgetSpec } from '@/features/dashboard/widget-catalog'
import { byWidgetOrder, nextWidgetOrder, swapWidgetOrder } from '@/features/dashboard/widget-order'
import {
  DASHBOARD_COLORS,
  WIDGET_METRICS,
  type WidgetMetric,
} from '@/services/airtable/mapping-dashboards'
import {
  addDashboardWidget,
  createDashboard,
  deleteDashboard,
  removeDashboardWidget,
  reorderDashboardWidgets,
  updateDashboard,
} from '@/services/airtable/mutations-dashboards'
import { listDashboards, listWidgetRowsUncached } from '@/services/airtable/reads-dashboards'

export type { DashboardActionResult } from '@/features/dashboard/action-result'

const NAME_LIMIT = 120
const DESCRIPTION_LIMIT = 500

/**
 * A gallery card, instantiated: one dashboard plus the widgets the template defines.
 *
 * The new tab's `href` is computed from the list as it was BEFORE the write, plus the row that
 * was just created. That is deliberate rather than re-reading: the write has already expired
 * `event:{id}:dashboards`, and asking for it again inside the same request is asking whether
 * Next has finished expiring it yet. The new row sorts last (its `order` is one past the
 * highest), so appending it reproduces exactly the strip the next request will render.
 */
export async function createDashboardFromTemplateAction(
  eventId: string,
  templateKey: string,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const template = dashboardTemplate(templateKey)
    if (template === undefined) return { ok: false, message: 'Unknown template.' }

    const existing = await listDashboards(eventId)
    const order = existing.reduce((highest, row) => Math.max(highest, row.order), 0) + 1
    const created = await createDashboard(
      {
        eventId,
        name: template.title,
        color: template.color,
        description: template.description,
        templateKey: template.key,
        order,
      },
      templateWidgets(template),
    )

    const tab = dashboardTabs(eventId, [...existing, created]).find(
      (candidate) => candidate.dashboardId === created.id,
    )
    return {
      ok: true,
      message: 'Dashboard created.',
      href: tab?.href ?? `/admin/${eventId}`,
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * "+ Add Widget", ref 38. One widget from the closed catalogue.
 *
 * The title and the shape come from `widget-catalog.ts` and not from the caller: a client that
 * could name the widget could also name a shape the metric cannot draw, and there is no reason
 * for the browser to be the source of either.
 */
export async function addWidgetAction(
  eventId: string,
  dashboardId: string,
  metric: string,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const dashboard = await ownedDashboard(eventId, dashboardId)
    const chosen = parseMetric(metric)
    if (chosen === undefined) return { ok: false, message: 'Unknown widget.' }

    const spec = widgetSpec(chosen)
    // Uncached, so two widgets added in a row cannot share an `order`. See reads-dashboards.ts.
    const rows = await listWidgetRowsUncached(dashboard.id)

    // One card per metric on a dashboard. Two cards counting the same eight-value aggregate
    // render identically, so a duplicate is never what the organizer meant, and refusing it
    // also caps a dashboard at the eight metrics that exist. That cap is load-bearing: the
    // reorder renumbers every row and the Airtable client chunks writes at ten, so a dashboard
    // of eleven made a move two requests, and two concurrent moves could interleave into
    // duplicate order values with no row at the vacated position. Under the ceiling a reorder
    // is one batch and cannot tear. Found by Codex review, 2026-08-10.
    if (rows.some((row) => row.metric === chosen)) {
      return { ok: false, message: `${spec.title} is already on this dashboard.` }
    }
    await addDashboardWidget({
      eventId,
      draft: {
        dashboardId: dashboard.id,
        title: spec.title,
        widgetType: spec.widgetType,
        metric: chosen,
        // One past the highest, not the row COUNT: the two disagree as soon as a widget has
        // been deleted, and `length` would then reuse an order the grid already has. Ordering
        // still breaks ties on record id, because two adds racing here both read the same
        // highest. Found by Codex review.
        order: nextWidgetOrder(rows),
      },
    })
    // Ref 38's toast copy is the caller's, because only the caller knows the write returned.
    return { ok: true, message: 'Widget added' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Remove one widget from a dashboard's grid.
 *
 * **`ownedDashboard` is not enough on its own here, and this is the whole reason for the third
 * read.** It authorizes a DASHBOARD against the event, and the record being deleted is a widget:
 * `DashboardWidgets` has no event column, so a posted widget id belonging to another event's
 * dashboard would otherwise be deleted by an organizer who is legitimately an admin of this one.
 * The row list is the uncached one for the same reason the delete path uses it: it is unmapped,
 * so a widget the grid cannot draw is still a widget this may remove.
 *
 * No `href`: the organizer stays on the dashboard, which is one widget shorter.
 */
export async function removeWidgetAction(
  eventId: string,
  dashboardId: string,
  widgetId: string,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const dashboard = await ownedDashboard(eventId, dashboardId)
    const rows = await listWidgetRowsUncached(dashboard.id)
    if (!rows.some((row) => row.id === widgetId)) return { ok: false, message: 'Unknown widget.' }

    await removeDashboardWidget({ eventId, widgetId })
    return { ok: true, message: 'Widget removed' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Move one widget past the neighbour the card names, which is `Move up` and `Move down`.
 *
 * The caller sends two widget ids and no position, because a position computed here would be
 * over a list that can hold a row the grid does not render: see `swapWidgetOrder`. Both ids are
 * checked against this dashboard's rows by the swap itself, since a stale or foreign id is
 * simply not in the list it is asked to exchange within.
 *
 * The whole dashboard is renumbered from 0 rather than the two rows patched, which is
 * `reorderDashboardWidgets`' rule: a template seeds several rows and a later add can tie, and a
 * two-row patch leaves the tie for Airtable's pagination to break differently next request.
 */
export async function moveWidgetAction(
  eventId: string,
  dashboardId: string,
  widgetId: string,
  swapWithId: string,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const dashboard = await ownedDashboard(eventId, dashboardId)
    // Sorted the way the grid sorts, so the order written back is the order that was on screen.
    const ordered = (await listWidgetRowsUncached(dashboard.id))
      .toSorted(byWidgetOrder)
      .map((row) => row.id)
    const moved = swapWidgetOrder(ordered, widgetId, swapWithId)
    if (moved === undefined) return { ok: false, message: 'Unknown widget.' }

    await reorderDashboardWidgets({ eventId, widgetIds: moved })
    return { ok: true, message: 'Widget moved' }
  } catch (error) {
    return failure(error)
  }
}

/**
 * The Settings dialog: the tab label, its dot colour, and the description line.
 *
 * A typed argument rather than `FormData`, because the caller is a controlled dialog and not a
 * native form post. Everything in it is still validated here: the name has to be non-empty, the
 * colour has to be one of `DASHBOARD_COLORS`, and both strings are cut to a length the column
 * should hold. Nothing is trusted because it arrived typed.
 */
export async function updateDashboardAction(
  eventId: string,
  dashboardId: string,
  edit: { name: string; color: string; description: string },
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const dashboard = await ownedDashboard(eventId, dashboardId)

    const name = edit.name.trim()
    if (name === '') return { ok: false, message: 'Name is required.' }
    const color = DASHBOARD_COLORS.find((option) => option === edit.color)
    const label = cut(name, NAME_LIMIT)
    const existing = await listDashboards(eventId)

    await updateDashboard({
      eventId,
      dashboardId: dashboard.id,
      edit: {
        name: label,
        color: color ?? dashboard.color,
        // Empty clears the line, which is why it is sent rather than omitted.
        description: cut(edit.description.trim(), DESCRIPTION_LIMIT),
      },
    })

    // A slug is derived from the name (dashboard-tabs.ts), so a RENAME moves the URL the
    // organizer is standing on. Without this the dialog closed and refreshed the old segment,
    // which no longer resolves, and an unresolvable admin segment answers HTTP 200 with the 404
    // body on Workers: a rename looked like it had deleted the dashboard. Computed from the list
    // as it was before the write with this row's new name substituted, for the same reason
    // `createDashboardFromTemplateAction` does not re-read: the write has already expired the
    // tag, and the strip is a pure function of the rows. Found by Codex review.
    const renamed = existing.map((row) => (row.id === dashboard.id ? { ...row, name: label } : row))
    const tab = dashboardTabs(eventId, renamed).find(
      (candidate) => candidate.dashboardId === dashboard.id,
    )
    return {
      ok: true,
      message: 'Your changes have been saved.',
      href: tab?.href ?? `/admin/${eventId}`,
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Delete one dashboard, its widgets with it.
 *
 * Answers with the event home's href, because the tab the caller is standing on is about to stop
 * resolving. The confirmation is the caller's (an `AlertDialog`), since only the UI knows whether
 * the organizer has been told.
 */
export async function deleteDashboardAction(
  eventId: string,
  dashboardId: string,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const dashboard = await ownedDashboard(eventId, dashboardId)
    // Every row linked to this dashboard, including one the grid could not draw. See
    // `listWidgetRowsUncached`: a mapped list would leave those rows behind for good.
    const rows = await listWidgetRowsUncached(dashboard.id)
    await deleteDashboard({
      eventId,
      dashboardId: dashboard.id,
      widgetIds: rows.map((row) => row.id),
    })
    return { ok: true, message: 'Dashboard deleted.', href: `/admin/${eventId}` }
  } catch (error) {
    return failure(error)
  }
}

function parseMetric(raw: string): WidgetMetric | undefined {
  return WIDGET_METRICS.find((candidate) => candidate === raw)
}
