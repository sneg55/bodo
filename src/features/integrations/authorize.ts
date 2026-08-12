// Who may look at the Integrations page, and who may press anything on it.
//
// Two functions because the page has TWO audiences and one of them is read-only.
// BUILD_SPEC 5.0d: "a reviewer may read this page; only an admin may press either
// control". A reviewer chasing a session that never reached Accelevents needs the sync
// log to see the error, and locking them out would send them to an organizer to read a
// diagnostic table back to them. Pressing `Sync now` is a different act: it writes rows
// into somebody else's registration platform.
//
// `integrationsRole` is a RENDER decision and returns a value; it deliberately does not
// redirect. `(admin)/admin/[eventId]/layout.tsx` above this reads the session in its own
// body and redirects there, before the first byte, and the settings tree has a
// route-level `loading.tsx`, so a `redirect()` from a page under it resolves after the
// shell has flushed and the Workers runtime cancels the request with no response at all
// (.claude/rules/bodo-conventions.md).
//
// `requireIntegrationsAdmin` is the ENFORCEMENT and it throws. Every Server Action in
// this feature calls it for itself, because an action is reachable by POST without any of
// these pages ever rendering, and because capability comes from `EventMemberships` on
// every call rather than from a role baked into the session cookie. BUILD_SPEC section 4.

import { isAppError } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'

/**
 * The role held on this event, or undefined for none.
 *
 * `reviewer` is enough to render. The caller compares against `'admin'` itself to decide
 * whether the controls are live, so the page has one answer to "who is this" rather than
 * two booleans that can disagree.
 */
export async function integrationsRole(eventId: string): Promise<EventRole | undefined> {
  try {
    // Asked at the FLOOR rather than through `eventRoleOf`, so that a caller holding no
    // membership and a caller holding no session take the same branch here: both mean
    // "render nothing", and the difference between them belongs to the layout's redirect.
    const { role } = await requireEventRole(eventId, 'reviewer')
    return role
  } catch (error) {
    // Every AUTH_* failure means the same thing to a page. Anything else is a real fault
    // and belongs in the error boundary rather than being flattened into "no access".
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}

/** The guard both controls call. Throws `AUTH_FORBIDDEN_ROLE` for a reviewer. */
export async function requireIntegrationsAdmin(eventId: string): Promise<void> {
  await requireEventRole(eventId, 'admin')
}
