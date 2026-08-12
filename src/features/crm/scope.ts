// The CRM's read scope: which events the viewer is allowed to see speakers from.
//
// Every other admin surface takes its scope from the URL, because every other admin surface
// is about one event and `/admin/[eventId]/layout.tsx` authorizes that id. The CRM is
// deliberately cross-event, so there is no id in the path to authorize and the authorized
// set is the viewer's own EventMemberships. Every CRM read intersects with `eventIds`, and
// nothing downstream may widen it.
//
// The pure half is separated from the session half on purpose. `scopeFromMemberships` is
// the rule (which events, in what order, deduplicated, and what "none" means) and it is
// unit tested without a cookie or a network. `requireCrmScope` is the wiring, and it is the
// function a Server Action calls for itself: the layout below is a convenience for a
// browser, not the security boundary, because an action is reachable by POST without the
// layout ever having rendered. BUILD_SPEC section 4.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireAdminUser } from '@/features/auth/wiring'
import { listMembershipsForUser } from '@/services/airtable/queries'
import type { EventMembership, RecordId } from '@/types/domain'

export type CrmScope = {
  readonly userId: RecordId
  /** What every CRM READ intersects with. Both roles are in here. */
  readonly eventIds: readonly RecordId[]
  /**
   * The subset the viewer holds `admin` on, which is what a CRM WRITE has to be scoped to.
   *
   * Reading the CRM and editing a person in it are different capabilities and a reviewer
   * holds only the first. The directory and the profile are cross-event, so there is no id
   * in the path for `requireEventRole` to check, and the alternative to carrying this is a
   * surface guessing an event id and finding out from a rejected action. A subset and never
   * a separate list: an event the viewer is not in cannot appear here, whatever the role.
   *
   * It is a rendering answer, not an access one. `saveSpeakerProfileAction` still calls
   * `requireEventRole(eventId, 'admin')` for itself, because an action is reachable by POST
   * with no page having rendered. This decides whether the Edit button exists.
   */
  readonly adminEventIds: readonly RecordId[]
  /** Chrome needs an event for the switcher header. First membership, per demo-login.ts:139. */
  readonly contextEventId: RecordId
}

/**
 * All the scope rule reads. Narrower than `EventMembership` so the rule cannot start
 * depending on a timestamp or an id without that showing up here first.
 *
 * `role` is read for `adminEventIds` alone. Read scope is still "is this event yours" and
 * both roles answer yes to that, which is why the two fields are computed separately below
 * rather than one being filtered out of the other.
 */
export type ScopeMembership = Pick<EventMembership, 'eventId' | 'role'>

/**
 * The viewer's scope, or `undefined` when they hold no membership anywhere.
 *
 * `undefined` rather than an empty scope, and the difference matters at the call site: an
 * empty scope reads as "the CRM is empty", which is a claim about the data. No membership
 * is a claim about the viewer, and it belongs in a 404 rather than in an empty table.
 *
 * Order is the reader's order, which is the same convention `adminDestination` in
 * demo-login.ts already lands an organizer on, so the CRM opens with the same event named
 * in the sidebar as `/admin` would have picked.
 *
 * INVARIANT, and the caller owns it: `memberships` must be the memberships OF `userId`.
 * Nothing here can check that, because `ScopeMembership` is deliberately narrowed to
 * `eventId` and carries no `userId` to compare against. Hand it one person's id with
 * another person's memberships and it returns a scope that claims to be the first while
 * granting the second's events. The only caller is `loadScope` below, which derives both
 * from one `requireAdminUser()` call, and any future caller must do the same: derive the
 * pair together, never assemble it from two sources.
 */
export function scopeFromMemberships(
  userId: RecordId,
  memberships: readonly ScopeMembership[],
): CrmScope | undefined {
  const eventIds = [...new Set(memberships.map((membership) => membership.eventId))]
  // `.at(0)` and not `[0]`: indexing a readonly array types as a present element, so the
  // empty case would be a condition the compiler considers unnecessary.
  const contextEventId = eventIds.at(0)
  if (contextEventId === undefined) return undefined
  // Filtered out of `eventIds` rather than mapped off `memberships` again, so it is a subset
  // by construction and in the same reader's order. Two memberships on one event, one of
  // them `admin`, makes that event editable: the guard the action runs would agree.
  const adminEvents = new Set(
    memberships.filter((membership) => membership.role === 'admin').map((m) => m.eventId),
  )
  return {
    userId,
    eventIds,
    adminEventIds: eventIds.filter((eventId) => adminEvents.has(eventId)),
    contextEventId,
  }
}

/**
 * The scope, or a throw. What every CRM Server Action and Route Handler calls first.
 *
 * Throws `AUTH_FORBIDDEN_ROLE` for a signed-in user with no membership, which is the same
 * answer `requireEventRole` gives for an event that is not yours, so a caller that already
 * handles one handles both.
 */
export async function requireCrmScope(): Promise<CrmScope> {
  const scope = await loadScope()
  if (scope === undefined) {
    throw new AppError(
      ErrorIds.AUTH_FORBIDDEN_ROLE,
      'no event membership, so there is no CRM scope to read',
    )
  }
  return scope
}

/**
 * The same scope for a layout, which needs three answers rather than two: `anonymous` for
 * no usable admin session at all, `undefined` for a signed-in user with no membership, and
 * the scope otherwise. They lead to different places, and collapsing them would bounce a
 * signed-in reviewer back to the login page they have just used.
 *
 * The `redirect()` stays in the layout body and not in here, because `redirect` throws to
 * unwind and the catch below would report it as a missing session.
 */
export async function crmScopeForViewer(): Promise<CrmScope | undefined | 'anonymous'> {
  try {
    return await loadScope()
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return 'anonymous'
    throw error
  }
}

async function loadScope(): Promise<CrmScope | undefined> {
  const { userId } = await requireAdminUser()
  return scopeFromMemberships(userId, await listMembershipsForUser(userId))
}
