// GET /admin-mode: leave impersonation and go back to the admin app.
//
// A route handler and a GET, exactly like /logout: the control is an anchor in the portal
// account menu (`Back to Admin Mode`, docs/parity/speaker-portal.md), so it works with
// scripting off. A forced GET from another site can only END an impersonation, which is a
// de-escalation, and the restored session is re-authorized from EventMemberships before it
// is issued.
//
// The note next to /logout claiming Next never prefetches a route handler is WRONG on
// 16.2.12, and it cost this feature a working exit until it was measured: opening the portal
// account menu fired `GET /admin-mode?_rsc=...`, which RAN this handler on hover, twice, so
// the session was restored and then bounced before the click landed. The menu items carry
// `prefetch={false}` for that reason (PortalChrome). Because a prefetch is not the only way
// this can be hit twice (a double click, the back button), the already-an-admin case below
// lands on the admin app rather than on the portal's login redirect.
//
// 303 rather than 307, so the browser follows with a GET.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { startedOnThisSite } from '@/features/auth/same-site'
import { clearSession } from '@/features/auth/session'
import { leavePortalImpersonation } from '@/features/auth/wiring'
import { portalEventId } from '@/features/portal/event-scope'

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}

export async function GET(request: Request): Promise<Response> {
  // A cross-site navigation carries the Lax cookie, so without this another origin could
  // push an impersonated organizer back into admin mode without them choosing it.
  if (!startedOnThisSite(request)) return seeOther('/portal')

  try {
    const { userId, eventId } = await leavePortalImpersonation()
    console.warn(`[impersonation] exit: user ${userId} returned to admin mode on event ${eventId}`)

    // The task board is where the entry control lives, so it is where leaving lands.
    return seeOther(`/admin/${eventId}/tasks`)
  } catch (error) {
    if (!isAppError(error)) throw error
    console.error(error.toLogLine())

    if (error.id === ErrorIds.AUTH_NO_SESSION) return seeOther('/login?next=%2Fportal')

    // The claim named an admin who no longer holds the role. Leaving them signed in as the
    // speaker would be worse than signing them out: the organizer would keep acting as
    // somebody after losing the permission that let them start.
    if (error.id === ErrorIds.AUTH_FORBIDDEN_ROLE) {
      await clearSession()
      return seeOther('/login?error=admin_mode')
    }

    // Not an impersonation session at all. Two shapes, and they lead different places: an
    // admin session is somebody who has already come back, so it lands in the admin app,
    // while a real speaker who followed a stale link goes back to the portal. Either way
    // the session is untouched.
    if (error.context.kind === 'user') return seeOther(`/admin/${portalEventId()}/tasks`)
    return seeOther('/portal')
  }
}
