// Magic links: POST issues one, GET consumes one.
//
// A route handler rather than a Server Action because the GET is a link target in
// an email, which is a plain navigation and has to work with no JavaScript at all.
//
// This is a public endpoint in both directions and is treated as one. The POST
// never reveals whether an address is known, and the GET's single-use enforcement
// is atomic rather than best effort, because a login link that sometimes works
// twice is not single use.

import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

import { type AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { consumeMagicLink, requestMagicLink } from '@/features/auth/magic-link'
import { resolveLoginSubject } from '@/features/auth/resolve-subject'
import { establishSession } from '@/features/auth/session'
import { sendEmail } from '@/services/email/send'
import { claimOnce } from '@/utils/cf'
import { appUrl, hasEmail, isLocalDeploy } from '@/utils/env'

/** Where a speaker lands after verifying, when the link carried no destination. */
const DEFAULT_DESTINATION = '/portal'

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData()
  // FormData values can be a File, so read them as strings explicitly rather than
  // coercing: String(someFile) is "[object File]", which would sail through as an
  // email address made of nonsense.
  const email = fieldOf(form, 'email')
  const redirectTo = fieldOf(form, 'next')
  const audience = fieldOf(form, 'audience') === 'admin' ? 'admin' : 'speaker'

  if (email.trim() === '') {
    return backToLogin({ error: 'missing_email', redirectTo, audience })
  }

  // Checked BEFORE the address is resolved, and the order is the whole point.
  //
  // Reporting an unconfigured provider is right: a magic link IS the login (§4), so
  // staying quiet leaves every visitor stranded with no second channel. But asking the
  // provider first and reporting `delivered: false` afterwards turned this into an
  // account-existence oracle, because an unknown address throws before it ever reaches
  // `sendEmail`. A known address got `error=undeliverable` and an unknown one got
  // `sent=1`, which is precisely the distinction §4 forbids.
  //
  // `hasEmail()` is a fact about the deployment and not about any address, so answering
  // from it leaks nothing and is identical for every caller.
  //
  // The one exception is a developer's own machine, where there is no second channel
  // to fall back to either but the server log IS reachable. `sendEmail` already logs
  // instead of sending when unconfigured (see note 1 in src/services/email/send.ts),
  // and this route short-circuiting above it was the reason that fallback never
  // covered login: a fresh clone could not sign in at all. Locally the link is printed
  // to the log and the visitor gets the same `sent=1` answer as everyone else, so the
  // constant-response property below is untouched: an unknown address still throws
  // AUTH_UNKNOWN_ADMIN before any link is minted, and is still caught and answered
  // identically.
  if (!hasEmail() && !isLocalDeploy()) {
    console.error('[auth] magic link not delivered: no email provider is configured')
    return backToLogin({ error: 'undeliverable', redirectTo, audience })
  }

  try {
    const requested = await requestMagicLink({
      email,
      audience,
      nowMs: Date.now(),
      origin: appUrl(),
      redirectTo: redirectTo === '' ? undefined : redirectTo,
      resolveSubject: resolveLoginSubject,
      send: sendEmail,
    })

    // Never on a deployment, and gated on `delivered` rather than on `hasEmail()` so
    // that a configured local deployment does not print a link that was really posted.
    if (!requested.delivered && isLocalDeploy()) {
      console.warn(`[auth] no email provider configured; sign-in link: ${requested.url}`)
    }
  } catch (error) {
    // An unknown address must be indistinguishable from a known one, or this
    // endpoint becomes an account enumerator.
    if (isAppError(error) && error.id === ErrorIds.AUTH_UNKNOWN_ADMIN) {
      // Nothing more to do: fall through to the same answer a sent link gets.
    } else if (isAppError(error) && error.id === ErrorIds.MAIL_SEND_FAIL) {
      // The provider refused THIS recipient. Foreseeable, so not a 500: a seeded
      // `@example.com` speaker hits it every time, because Resend rejects that domain by
      // name ("Please use our testing email address instead of domains like
      // `example.com`"), and an unhandled throw turned an ordinary login attempt into a
      // crash page.
      //
      // Answered identically to a successful send, and that is the uncomfortable call
      // worth stating rather than hiding. A distinct answer here would be more useful to
      // the visitor, and it would also leak that the address IS registered, because an
      // unregistered one never reaches the provider at all. §4 says the response must not
      // depend on whether an account exists, so the operator gets the detail in the log
      // and the page stays constant. The log line now carries the provider's own reason.
      console.error(`[auth] magic link rejected by provider: ${error.message}`)
    } else {
      throw error
    }
  }

  // One answer for every address, whether it exists, whether the provider took it, and
  // whether it was refused. The only branch that differs is the unconfigured check above,
  // which is deployment-wide.
  return backToLogin({ sent: true, redirectTo, audience })
}

/**
 * Send the browser back to the form, which is where the visitor can act.
 *
 * A 303 rather than a JSON body. This is a plain `<form method="post">` so that signing
 * in works with scripting off (§4), which means the browser NAVIGATES to whatever this
 * returns: answering with `{"ok":true}` rendered that JSON as the page. The login page
 * already reads `sent` and `error` from its query string, so it was only ever the
 * redirect that was missing.
 *
 * 303 specifically, so the follow-up is a GET. A 302 lets a browser re-POST the form on
 * reload, which would mint a second link.
 */
function backToLogin(options: {
  sent?: boolean
  error?: string
  redirectTo: string
  audience: string
}): Response {
  const params = new URLSearchParams()
  if (options.sent === true) params.set('sent', '1')
  if (options.error !== undefined) params.set('error', options.error)
  // Carried through so a refused attempt does not silently drop where the visitor was
  // heading, or which form they came in on.
  if (options.redirectTo !== '') params.set('next', options.redirectTo)
  if (options.audience === 'admin') params.set('audience', 'admin')

  return new Response(null, {
    status: 303,
    headers: { location: `/login?${params.toString()}` },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get('token')
  if (token === null || token === '') {
    redirect('/login?error=missing')
  }

  let destination = DEFAULT_DESTINATION
  try {
    const consumed = await consumeMagicLink({
      token,
      nowMs: Date.now(),
      claim: claimOnce,
      establish: establishSession,
    })
    destination = consumed.redirectTo ?? DEFAULT_DESTINATION
  } catch (error) {
    // Expired and already-used are ordinary outcomes and the login page explains
    // them. Anything else is a fault and should surface as a 500 rather than
    // quietly reading as a bad link.
    if (isAppError(error) && isRecoverable(error)) {
      redirect(`/login?error=${reasonFor(error)}`)
    }
    throw error
  }

  // Outside the try: `redirect` throws to unwind, so calling it inside would be
  // caught by the block above and reported as a bad token.
  redirect(destination)
}

function fieldOf(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function isRecoverable(error: AppError): boolean {
  return (
    error.id === ErrorIds.AUTH_TOKEN_EXPIRED ||
    error.id === ErrorIds.AUTH_TOKEN_REUSED ||
    error.id === ErrorIds.AUTH_TOKEN_INVALID
  )
}

function reasonFor(error: AppError): string {
  if (error.id === ErrorIds.AUTH_TOKEN_EXPIRED) return 'expired'
  if (error.id === ErrorIds.AUTH_TOKEN_REUSED) return 'used'
  return 'invalid'
}
