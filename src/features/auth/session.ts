// The session cookie: how it is written, how it is read back, and how the current
// subject is resolved from it.
//
// `cookies()` from next/headers is async in Next 16 and it throws outside a request
// scope, so it is imported dynamically inside the two functions that need it. That
// keeps this module importable from a unit test (and mirrors how src/utils/cf.ts
// reaches the Cloudflare adapter). Writes only work in a Server Action or a Route
// Handler, per next/headers' own documentation: a Server Component may read the
// cookie but cannot set it, because response headers are already committed.
//
// `nowMs` is a required argument everywhere rather than a `Date.now()` call inside
// these functions. The entry point (action, route handler) stamps one instant and
// the cookie's expiry, the JWT's `exp`, and the ClaimGuard TTL all agree on it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  authSecret,
  mintSessionToken,
  SESSION_TTL_MS,
  type SessionSubject,
  verifySessionToken,
} from '@/features/auth/tokens'
import { isDemoMode } from '@/utils/env'

export const SESSION_COOKIE_NAME = 'bodo_session'

export type SessionCookieAttributes = {
  httpOnly: true
  secure: true
  sameSite: 'lax'
  path: '/'
  maxAge: number
  expires: Date
}

/**
 * Pure, so the attributes are assertable in a test instead of only observable in a
 * browser.
 *
 * `sameSite: 'lax'` and not `'strict'`: the magic link is a cross-site GET from a
 * mail client into the app, and Strict withholds the cookie on exactly that
 * navigation, which logs the user out at the moment they arrive. `secure: true` is
 * unconditional; Chrome and Firefox treat http://localhost as a secure context, so
 * dev still works, and making it conditional would mean a misread DEPLOY_ENV could
 * ship a session cookie that travels in the clear.
 */
export function sessionCookieAttributes(options: { nowMs: number }): SessionCookieAttributes {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    expires: new Date(options.nowMs + SESSION_TTL_MS),
  }
}

/**
 * `StaticGenBailoutError`, which is the one framework signal `unstable_rethrow` misses.
 *
 * It flags itself on `code` rather than on `digest`, and it is thrown when a route
 * declared `force-static` reads a dynamic API. That is a real configuration mistake the
 * developer has to see, so it must not be reported as a missing session either.
 * Matched structurally because the class lives at
 * `next/dist/client/components/static-generation-bailout`, an internal path.
 */
function isStaticGenBailout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'NEXT_STATIC_GEN_BAILOUT'
  )
}

// Return type inferred from next/headers rather than restated: an approximation of
// ReadonlyRequestCookies here would drift the moment Next changes an overload.
async function cookieStore() {
  try {
    const { cookies } = await import('next/headers')
    return await cookies()
  } catch (cause) {
    // Next signals control flow by THROWING, and those throws must not be converted.
    // `cookies()` raises `DynamicServerError` during a static prerender, which is not a
    // failure: it is how a route tells the build that it is dynamic. Wrapping it made
    // `next build` fail on `/portal/profile` with `E_AUTH_004` instead of marking the
    // route dynamic.
    //
    // `unstable_rethrow` is Next's own definition of that set and rethrows if it
    // matches, so it stays correct as the set changes. It covers seven cases, including
    // ones no digest check would catch (React postpone, hanging-promise rejection,
    // prerender-interrupted, bailout-to-CSR), and it recurses into `cause`. An earlier
    // fix here hand-rolled "any error with a string `digest`", which was both broader
    // than Next (a redirect digest is `NEXT_REDIRECT;push;/path;307;`, and Next
    // validates every segment) and narrower (postpone carries no digest at all).
    const { unstable_rethrow } = await import('next/navigation')
    unstable_rethrow(cause)
    if (isStaticGenBailout(cause)) throw cause

    throw new AppError(
      ErrorIds.AUTH_NO_SESSION,
      'cookies() is unavailable here: session reads and writes need a request scope',
      { cause: String(cause) },
    )
  }
}

/**
 * Mint a fresh session token and set the cookie. Also the rotation path: verifying
 * a magic link calls this, and `set` overwrites whatever session was there, so a
 * consumed link never leaves the previous session in place.
 */
export async function establishSession(options: {
  subject: SessionSubject
  nowMs: number
  secret?: Uint8Array
}): Promise<void> {
  const token = await mintSessionToken({
    subject: options.subject,
    nowMs: options.nowMs,
    secret: options.secret ?? authSecret(),
  })
  const store = await cookieStore()
  store.set(SESSION_COOKIE_NAME, token, sessionCookieAttributes({ nowMs: options.nowMs }))
}

export async function clearSession(): Promise<void> {
  const store = await cookieStore()
  store.delete(SESSION_COOKIE_NAME)
}

/**
 * The subject this request is acting as, or undefined when there is no usable
 * session.
 *
 * An expired or tampered cookie reads as "not signed in" rather than raising: the
 * browser keeps sending it on every request, and the only useful answer is to offer
 * a fresh magic link. `requireSession` in guards.ts is what turns undefined into an
 * AUTH_NO_SESSION failure at the point where a caller actually needs an identity.
 */
export async function currentSubject(options: {
  nowMs: number
  secret?: Uint8Array
}): Promise<SessionSubject | undefined> {
  const store = await cookieStore()
  const cookie = store.get(SESSION_COOKIE_NAME)
  if (cookie === undefined || cookie.value === '') return undefined

  try {
    const subject = await verifySessionToken({
      token: cookie.value,
      nowMs: options.nowMs,
      secret: options.secret ?? authSecret(),
    })

    // Turning DEMO_MODE off has to close the door it opened, and the endpoint 404ing is
    // not enough: sessions already handed out through it are ordinary 30 day cookies and
    // would keep working for a month on a deployment that has stopped advertising a demo
    // at all. Checked here rather than in a guard because this is the single place the
    // cookie is turned into an identity, so no entry point can be the one that forgot.
    //
    // Reads as "not signed in", like an expired or tampered cookie, for the same reason:
    // the useful answer is the login page, not an error. (Codex review finding.)
    if (subject.viaDemo === true && !isDemoMode()) return undefined

    return subject
  } catch {
    return undefined
  }
}
