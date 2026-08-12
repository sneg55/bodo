'use server'

// Putting back an event's missing default portal, from inside the product.
//
// WHY THIS EXISTS. §5.0c says the default portal is created WITH the event, and both writers
// do it (`createDefaultPortal` in features/events/actions.ts, `seedDefaultPortal` in
// scripts/seed). An event that has lost the row, or predates them, therefore lands in a state
// the product could describe and not repair: `requireOneDefault` refuses every portal write
// until exactly one default exists, so the Portals screen showed an organizer a dead end and
// told them to add the row in Airtable themselves. An organizer who cannot open the base, or
// does not know the schema, was simply stuck on a screen with nothing to press.
//
// A data gap the app knows how to close is not a message, it is a button. The row this writes
// is byte-for-byte the one the event creator would have got: same name, same kind, no
// filters, position 0, both switches off.
//
// Its own file rather than an export from ./actions.ts, which is at the 300 line limit. The
// seam is honest anyway: everything in that file EDITS a portal list an organizer is
// managing, and this one repairs the precondition that file refuses to run without.

import { requirePortalAdmin } from '@/features/portal-config/authorize'
import { type PortalActionResult, portalActionFailure } from '@/features/portal-config/invariants'
import { createPortal } from '@/services/airtable/mutations-portals'
import { listPortalsUncached } from '@/services/airtable/reads-portals'
import type { RecordId } from '@/types/domain'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

export async function createDefaultPortalAction(eventId: RecordId): Promise<PortalActionResult> {
  try {
    await requirePortalAdmin(eventId)

    // The UNCACHED read, and it is the whole safety of this action. The invariant is exactly
    // one default per event, and the screen that offers this button renders from a cached
    // list that can be up to a minute old. Branching on that would let two organizers on the
    // same stale screen, or one who pressed twice, each write a default and leave the event
    // in the state this exists to get it out of, only worse: `requireOneDefault` refuses at
    // two just as it refuses at zero.
    const portals = await listPortalsUncached(eventId)
    const defaults = portals.filter((portal) => portal.isDefault)
    if (defaults.length > 0) {
      return {
        ok: false,
        error:
          defaults.length === 1
            ? 'This event already has a default portal. Reload the page to see it.'
            : `This event has ${String(defaults.length)} default portals and needs exactly one.`,
      }
    }

    // Identical to `createDefaultPortal` in features/events/actions.ts, deliberately: an
    // event repaired here must not end up with a different default from one created whole.
    // No filters and position 0 because the default is the "everyone else" bucket by
    // definition, never a match candidate (`match.ts`), and both switches start off because
    // a portal that silently arrived with capabilities enabled is one nobody chose to grant.
    const created = await createPortal({
      eventId,
      name: 'Speaker Portal',
      kind: 'contacts',
      isDefault: true,
      order: 0,
      filters: EMPTY_PORTAL_FILTERS,
      alwaysShowTasks: false,
      manageProfile: false,
    })

    return { ok: true, portalId: created.id }
  } catch (error) {
    return portalActionFailure(error)
  }
}
