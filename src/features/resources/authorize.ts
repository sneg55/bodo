// "Is the person looking at this page an organizer of this event?", for the admin pages.
//
// One copy, imported by the three routes under `/admin/[eventId]/resources`, because three
// copies of an authorization check is how one of them ends up asking for `reviewer`.
//
// This is the RENDER decision, not the enforcement. The enforcement is
// `requireEventRole` inside each Server Action (./actions.ts), because an action is
// reachable by POST without any of these pages rendering. What this buys is that an
// unauthorized browser sees nothing rather than an empty list, and it deliberately does not
// redirect: the layout above has already done that, and a redirect from a page body that
// the layout would also have caught is a second answer to a question already settled.
//
// `admin`, never `reviewer`. `EVENT_ROLES` ranks admin above reviewer, so an organizer
// passes; publishing a page to every speaker at the conference is not a review capability.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'

export async function isEventOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    // Every AUTH_* failure means the same thing to a page: render nothing. Anything else
    // is a real fault and belongs in the error boundary.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
