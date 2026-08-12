// Demo sign-in: POST a persona, get a session.
//
// A route handler and a plain form rather than a Server Action, for the same reason
// /api/auth/magic is one: signing in has to work with scripting off (BUILD_SPEC §4),
// and this is now the only way in on a deployment that has no mailbox.
//
// POST and not GET, deliberately. src/features/auth/same-site.ts records that the two
// existing state-changing GETs owe a rewrite to "POST with Origin validation"; this
// endpoint is new, so it is built that way from the start rather than joining the
// debt. The Origin check below is what makes a cross-site form unable to silently
// establish a session in somebody's browser.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { isDemoPersona, signInAsDemoPersona } from '@/features/auth/demo-login'
import { resolveLoginSubject } from '@/features/auth/resolve-subject'
import { establishSession } from '@/features/auth/session'
import { readLandingEvent } from '@/features/events/landing-event'
import { listMembershipsForUser } from '@/services/airtable/queries'
import { appUrl, demoIdentityEmails, isDemoMode } from '@/utils/env'

export async function POST(request: Request): Promise<Response> {
  // 404 and not 403: a deployment that never turned demo mode on should look like one
  // that has no such endpoint, rather than one guarding a door it refuses to open.
  if (!isDemoMode()) {
    return new Response(null, { status: 404 })
  }

  if (!isSameOrigin(request)) {
    return new Response(null, { status: 403 })
  }

  const form = await request.formData()
  const persona = form.get('persona')
  if (typeof persona !== 'string' || !isDemoPersona(persona)) {
    return backToLogin('demo_persona')
  }

  try {
    const { destination } = await signInAsDemoPersona({
      persona,
      emails: demoIdentityEmails(),
      nowMs: Date.now(),
      resolveSubject: resolveLoginSubject,
      establish: establishSession,
      loadMemberships: listMembershipsForUser,
      readEvent: readLandingEvent,
    })
    return seeOther(destination)
  } catch (error) {
    // A configured persona that cannot be signed in as is an operator mistake in the
    // demo seeding, so the detail belongs in the log where the operator will look. The
    // page says only that the demo is misconfigured: it names no address, because no
    // visitor typed one and no visitor can fix it.
    if (isAppError(error) && error.id === ErrorIds.AUTH_DEMO_IDENTITY_MISSING) {
      console.error(`[auth] demo sign-in unavailable for ${persona}: ${error.message}`)
      return backToLogin('demo_unavailable')
    }
    throw error
  }
}

/**
 * Reject a cross-origin form post.
 *
 * `Origin` is set by the browser on every POST and cannot be written from script, so
 * comparing it against this deployment's own origin is what stops another site from
 * posting here. Absent is refused rather than allowed, which is the opposite of the
 * call `startedOnThisSite` makes for /logout, and deliberately so: being unable to
 * sign OUT is a harm in itself, while being unable to enter a demo is an inconvenience
 * a visitor resolves by clicking the button on the page.
 *
 * Two origins count as ours, and both are needed. `request.url` is what the runtime
 * received, which is the whole answer when nothing sits in front of the app.
 * `APP_URL` is the origin this deployment declares itself to serve from, and the env
 * schema already requires it to be an https origin in production; accepting it means a
 * front door that terminates TLS and forwards under a different host does not turn
 * every demo sign-in into a 403. Both are this deployment, so accepting either widens
 * nothing an attacker controls.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null || origin === '') return false
  return originsOf(request).includes(origin)
}

function originsOf(request: Request): readonly string[] {
  const ours: string[] = []
  for (const candidate of [request.url, appUrl()]) {
    try {
      ours.push(new URL(candidate).origin)
    } catch {
      // A URL that will not parse contributes no origin. `request.url` always parses
      // and `appUrl()` is schema-checked, so this is belt and braces.
    }
  }
  return ours
}

function seeOther(location: string): Response {
  // 303 so the follow-up is a GET. A 302 would let a reload re-POST the form, which
  // here means re-establishing the session on every back-button press.
  return new Response(null, { status: 303, headers: { location } })
}

function backToLogin(error: string): Response {
  return seeOther(`/login?error=${error}`)
}
