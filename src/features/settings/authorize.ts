// Is the caller an organizer on this event?
//
// A boolean rather than a throw, because the pages under `/admin/{eventId}/settings` want
// to render nothing while the LAYOUT does the redirect: a `redirect()` from a page body
// that sits under a route-level `loading.tsx` resolves after the shell has flushed, and on
// Workers that is a hung request the runtime cancels.
//
// This is NOT the security boundary. Every Server Action in this feature calls
// `requireEventRole(eventId, 'admin')` for itself, because an action is reachable by POST
// without any of these pages ever rendering. BUILD_SPEC section 4.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'

export async function isSettingsOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
