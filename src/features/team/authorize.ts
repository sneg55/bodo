// Is the caller an admin on this event?
//
// A boolean rather than a throw, for the reason `features/settings/authorize.ts` gives about
// the same question: the page renders nothing and the LAYOUT does the redirect, because a
// `redirect()` from a page body underneath a route-level `loading.tsx` resolves after the
// shell has flushed, and on Workers that never produces a response.
//
// A REVIEWER reaches this page (the layout admits any membership) and gets `false`, which is
// correct and deliberate: the whole content of the page is who holds which role, and reading
// it is how you would learn whose account to go after. `admin`, not `reviewer`.
//
// This is NOT the security boundary. Every action in this feature calls
// `requireEventRole(eventId, 'admin')` for itself, because an action is reachable by POST
// without this page ever rendering. BUILD_SPEC section 4.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'

export async function isTeamOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
