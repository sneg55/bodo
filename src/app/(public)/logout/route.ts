// GET /logout: drop the session cookie and go back to the login form.
//
// Both account menus have linked here since they were written (`AdminShellSlots` and
// `PortalFrame` both pass `logoutHref="/logout"`) and the route did not exist, so Logout
// was a 404 for every user in both apps. `clearSession()` was written at the same time as
// `establishSession()` and had no caller anywhere; this is the caller.
//
// A route handler and a GET, matching the magic link's consume half, because the control
// is an anchor in a dropdown and has to work with scripting off.
//
// CORRECTION. This comment used to claim Next does not prefetch route handlers, only pages.
// That is false on 16.2.12 and it was stated as fact without being checked. Opening the
// account menu fired `GET /logout?_rsc=...` and `GET /admin-mode?_rsc=...` and RAN both
// handlers, which was observed twice independently: it signed a person out as they opened
// the menu, and it also explains the `this entry point requires a speaker session` error
// that was appearing in the worker log on every admin page load, from the top bar's
// prefetched portal link.
//
// So the protection is explicit rather than assumed: every menu item pointing at a route
// handler carries `prefetch={false}` (see `PortalChrome` and `AdminTopBar`). A GET that
// changes state is still the wrong shape in principle, and it is kept only because signing
// out has to work with scripting off. If that requirement is ever dropped, this should
// become a POST.
//
// 303 rather than 307, so the browser follows with a GET and the Location is not re-issued
// as whatever method arrived.

import { startedOnThisSite } from '@/features/auth/same-site'
import { clearSession } from '@/features/auth/session'

export async function GET(request: Request): Promise<Response> {
  // A cross-site navigation carries the Lax cookie, so without this a link from another
  // origin could sign somebody out. `startedOnThisSite` explains what it does and does not
  // cover. Answering 303 to the login page either way, so the refusal is not a dead end.
  if (!startedOnThisSite(request)) {
    return new Response(null, { status: 303, headers: { location: '/login' } })
  }

  await clearSession()

  return new Response(null, {
    status: 303,
    // `signed_out` so the login page can say something, rather than looking like the
    // session simply expired on its own.
    headers: { location: '/login?signed_out=1' },
  })
}
