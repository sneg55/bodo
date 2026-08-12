// Who may change a custom dashboard.
//
// `ownedDashboard` IS the enforcement, and every action in ./actions.ts calls it after
// `requireEventRole`. A Server Action is reachable by POST without any page or layout ever
// rendering (BUILD_SPEC 4), so a caller who holds admin on event A could otherwise post event
// B's dashboard id and rename, add a widget to, or delete B's dashboard. The uncached read is
// the point: a cached one authorizes against a row's old event link.
//
// `admin`, never `reviewer`. `EVENT_ROLES` ranks admin above reviewer, so an organizer passes
// both; a dashboard is an organizer's own workspace and a reviewer who could delete one could
// take a tab off somebody else's screen.
//
// A widget has no event link of its own, so it is authorized through its dashboard, and that is
// also why `addDashboardWidget` takes the event id from its caller rather than reading it off
// the row it is about to write.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { Dashboard } from '@/services/airtable/mapping-dashboards'
import { getDashboard } from '@/services/airtable/reads-dashboards'

export async function ownedDashboard(eventId: string, dashboardId: string): Promise<Dashboard> {
  const dashboard = await getDashboard(dashboardId)
  if (dashboard.eventId !== eventId) {
    // Not "not found": a caller who holds admin on this event posted another event's id.
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'dashboard does not belong to event', {
      eventId,
      dashboardId,
    })
  }
  return dashboard
}
