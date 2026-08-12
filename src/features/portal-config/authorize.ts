// "May this caller change this event's portals?", for the R5.0c admin surface.
//
// One copy, imported by every action in ./actions.ts, because five copies of an
// authorization check is how one of them ends up asking for `reviewer`.
//
// `admin`, never `reviewer`. `EVENT_ROLES` ranks admin above reviewer, so an organizer
// passes. A portal decides which speakers see which tasks and pages, and rewriting the
// audience of the whole speaker experience is not a review capability, the same call
// `features/resources/authorize.ts` makes about publishing a page.
//
// This is the ENFORCEMENT, not a render decision. It runs inside each Server Action rather
// than only in `(admin)/admin/[eventId]/layout.tsx`, because a Server Action is reachable by
// POST with no layout ever rendering (BUILD_SPEC 4). The layout guard stays, and it is how a
// browser gets redirected to /login, which is UX.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { getPortal } from '@/services/airtable/reads-portals'
import type { RecordId } from '@/types/domain'
import type { Portal } from '@/types/portals'

/**
 * Assert the caller organizes this event. Throws `AUTH_FORBIDDEN_ROLE` otherwise.
 *
 * Capability comes from `EventMemberships` on every call and never from the session cookie,
 * so removing somebody from the event takes effect on their next request rather than when a
 * 30 day token expires.
 */
export async function requirePortalAdmin(eventId: RecordId): Promise<void> {
  await requireEventRole(eventId, 'admin')
}

/**
 * The portal, or a refusal, given the event the caller was already authorized for.
 *
 * Step two of the sequence `features/resources/actions.ts` sets out, and it is not
 * redundant with step one: holding admin on event A does not make A's actions safe to point
 * at event B's record ids. Without this check a portal id from another conference is edited
 * cleanly and the wrong tag is expired.
 *
 * Uncached, because this is what decides a write. `getPortal` reads live for exactly that
 * reason (reads-portals.ts): a cached answer authorizes against a row's old event link, and
 * would let a portal that became the default seconds ago still be deleted on the strength of
 * the unchecked box the cache is holding.
 *
 * A mismatch raises `AUTH_FORBIDDEN_ROLE` rather than "not found", because that is what it
 * is: a caller who holds admin here and posted somebody else's record id.
 */
export async function ownedPortal(eventId: RecordId, portalId: RecordId): Promise<Portal> {
  const portal = await getPortal(portalId)
  if (portal.eventId !== eventId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'portal does not belong to event', {
      eventId,
      portalId,
    })
  }
  return portal
}

/**
 * "Is the person looking at this page an organizer of this event?", for the pages.
 *
 * The RENDER decision, so an unauthorized browser sees nothing rather than an empty portal
 * list. It deliberately does not redirect: the layout above has already done that, and a
 * redirect from a page body that the layout would also have caught is a second answer to a
 * question already settled. It is also not a substitute for `requirePortalAdmin`, which is
 * what actually refuses a POST.
 */
export async function isEventOrganizer(eventId: RecordId): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    // Every AUTH_* failure means the same thing to a page: render nothing. Anything else is
    // a real fault and belongs in the error boundary.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
