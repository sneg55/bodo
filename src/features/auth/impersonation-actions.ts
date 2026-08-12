'use server'

// The entry point for "view the portal as this speaker", called from the admin task board.
//
// A Server Action rather than a route handler, unlike the auth routes next to it. Sign-in
// is a route handler because it has to work with scripting off (BUILD_SPEC 4), and this
// control does not: it lives in the onboarding table, which is a client component with
// local search and paging, so there is no no-JS version of the surface to preserve. What a
// Server Action buys instead is Next's own same-origin check on the POST, so another site
// cannot navigate a signed-in organizer into acting as somebody.
//
// The `redirect()` sits AFTER the try/catch on purpose. It signals by throwing, and a
// throw inside the try would be handed to `actionFailure`, which rethrows anything that is
// not an AppError: correct, but only by accident. Outside the block it is plain.
//
// A redirect and not a returned href, because the response to this action carries the new
// cookie: re-rendering the admin page the organizer is standing on would re-render it with
// a speaker session, which its own layout would then bounce to /login.

import { redirect } from 'next/navigation'

import { enterPortalAsSpeaker } from '@/features/auth/wiring'
import { type ActionFailure, actionFailure } from '@/features/review/action-result'

/** Where an impersonated session lands. The portal's own Home. */
const PORTAL_HOME = '/portal'

/**
 * Resolves to a failure the caller can toast, or does not resolve at all because the
 * browser is being sent to the portal.
 */
export async function startImpersonationAction(input: {
  eventId: string
  speakerId: string
}): Promise<ActionFailure | undefined> {
  try {
    const { userId, speakerId } = await enterPortalAsSpeaker(input)
    // The only durable record that what follows was done by an organizer. No table in the
    // schema has an actor column, so this log line is the audit trail, and it is written
    // before the redirect so it exists even if the navigation is abandoned.
    console.warn(
      `[impersonation] enter: user ${userId} is acting as speaker ${speakerId} on event ${input.eventId}`,
    )
  } catch (error) {
    return actionFailure(error)
  }

  redirect(PORTAL_HOME)
}
