// One routed dashboard segment. Two kinds of thing live here, and that is deliberate.
//
// The Today dashboard's SUB-TABS come first: ref 37 captures
// `appv2.sessionboard.com/event/6703/dashboard/evaluations` in the address bar, so that segment
// shape is transcribed and not invented. A CUSTOM dashboard is a tab in the same strip
// (`/dashboard/{slug}`, ref 34), so it resolves out of the same segment rather than getting a
// route of its own: one segment cannot be two routes, and inventing `/dashboard/d/{slug}` to
// avoid the overlap would put a URL shape in the address bar that the reference does not have.
// The sub-tabs win when a slug could be both, and `dashboard-tabs.ts` explains what that costs
// (a dashboard named "Participants" answers to `participants-2`).
//
// `notFound()` is called in the page BODY, which is the only place it can be called: reached
// from inside a `<Suspense>` boundary it renders the 404 page after the status line has already
// been sent, so the response is HTTP 200 with the 404 body. The admin tree's `loading.tsx` is
// itself such a boundary and is kept deliberately, so that cost is accepted here exactly as it
// already is for an admin `[id]` route with a bogus id. This is also why the slug is resolved
// HERE, awaiting the read in the body, rather than inside the component that renders it.
//
// `redirect()` is deliberately NOT used for an unknown tab, even though it would be friendlier:
// on Workers a redirect issued under a boundary produces no response at all and the runtime
// cancels the request, which is a 500 rather than a 404.

import { notFound } from 'next/navigation'
import { CustomDashboard } from '@/features/dashboard/CustomDashboard'
import { loadCustomDashboard } from '@/features/dashboard/dashboard-reads'
import { EventHome } from '@/features/dashboard/EventHome'
import { homeTabFromSlug } from '@/features/dashboard/sub-tabs'
import { requireEventId } from '@/features/events/resolve-ref'

export default async function DashboardTabPage({
  params,
}: {
  params: Promise<{ eventId: string; tab: string }>
}) {
  const { eventId: eventRef, tab } = await params
  const eventId = await requireEventId(eventRef)

  // The default tab resolves here too, so a shared or hand-typed
  // `/dashboard/submission-forms` renders instead of 404ing. The strip still links it to the
  // bare `/admin/{eventId}`, which stays the one canonical URL for it.
  const homeTab = homeTabFromSlug(tab)
  if (homeTab !== undefined) return <EventHome eventId={eventId} tab={homeTab} />

  const view = await loadCustomDashboard(eventId, tab)
  if (view === undefined) notFound()

  return <CustomDashboard eventId={eventId} view={view} />
}
