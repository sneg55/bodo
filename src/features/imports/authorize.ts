// Who may start an import. BUILD_SPEC 5.0e: "admin only, checked in the action".
//
// A file of its own rather than a third export on `features/integrations/authorize.ts`,
// because the two surfaces genuinely have different audiences and putting them together
// would invite the wrong one being called. The Integrations PAGE has two audiences: a
// reviewer may read it, since chasing a session that never reached Accelevents means
// reading the sync log. The import wizard has one. An import writes the whole event, rooms
// and tracks and tags and speakers and submissions and their agenda placement, so there is
// no read-only half of it worth rendering to somebody who cannot press the button.
//
// The RENDER check and the ENFORCEMENT are still two different things here, exactly as
// they are next door. `importWizardRole` returns a value and never redirects, because
// `(admin)/admin/[eventId]/layout.tsx` reads the session in its own body and redirects
// before the first byte, and a `redirect()` from a page under a route-level `loading.tsx`
// resolves after the shell has flushed, which on Workers is a request the runtime cancels
// with no response at all (.claude/rules/bodo-conventions.md).
//
// `requireImportAdmin` throws, and every Server Action in this feature calls it for itself.
// An action is reachable by POST without the wizard ever rendering, and capability comes
// from `EventMemberships` on every call rather than from a role baked into the session
// cookie (BUILD_SPEC section 4).

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { integrationsRole } from '@/features/integrations/authorize'
import { getImportRun } from '@/services/airtable/reads-imports'
import type { ImportRun } from '@/types/imports'

/**
 * The role held on this event, or undefined for none.
 *
 * Delegates to `integrationsRole` rather than repeating its try/catch, so the wizard and
 * the page it hangs off cannot disagree about who is looking. The wizard compares the
 * answer against `'admin'` itself: a reviewer who followed the `Import` link gets told why
 * the wizard will not run for them, which is more use than a blank screen.
 */
export async function importWizardRole(eventId: string): Promise<EventRole | undefined> {
  return await integrationsRole(eventId)
}

/**
 * The guard every import action calls first. Throws `AUTH_FORBIDDEN_ROLE` for a reviewer.
 *
 * Called on the preview too, not only on the write. A preview reads a third-party event
 * through a token the caller supplied and reads this event's `IntegrationMappings` to split
 * creates from updates, so an unauthorized caller reaching it would learn the shape of the
 * event's data without ever writing a row.
 */
export async function requireImportAdmin(eventId: string): Promise<void> {
  await requireEventRole(eventId, 'admin')
}

/**
 * The guard for any action that takes a RUN ID, and it is a different guard on purpose.
 *
 * `requireImportAdmin(input.eventId)` alone is not enough here and the gap is exploitable:
 * the capability would be checked against the event the CALLER named, while `runImport`
 * loads the event off the run row and writes THAT one. An admin of event A posting their
 * own event id together with a run id belonging to event B would pass the check and then
 * drive an import that writes every table on event B.
 *
 * So the authorized event and the written event are made provably the same one: the run is
 * read first, the event id is taken FROM THE RUN, the claim is refused if it disagrees, and
 * the capability is checked against the run's own event. The read is `getImportRun`, which
 * is uncached, because a cached row is exactly the wrong thing to authorize against.
 *
 * `AUTH_FORBIDDEN_ROLE` rather than "not found", for the reason `requireOwnPortal` gives in
 * `features/portal-config/invariants.ts`: a caller who holds admin on one event and posted
 * another event's record id is not looking at a missing row, and answering "not found"
 * would make the id itself a probe for which runs exist.
 */
export async function requireImportAdminForRun(
  runId: string,
  claimedEventId: string,
): Promise<ImportRun> {
  const run = await getImportRun(runId)
  if (run.eventId !== claimedEventId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'import run does not belong to event', {
      claimedEventId,
      runId,
    })
  }
  // Against the RUN's event, which after the check above is the same string, so the event
  // this authorizes and the event `runImport` will write cannot come apart.
  await requireEventRole(run.eventId, 'admin')
  return run
}
