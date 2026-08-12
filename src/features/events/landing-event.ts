// The one Airtable read `chooseAdminLanding` needs, bound to the DAL.
//
// It is here rather than in `features/auth/landing.ts` because that file is pure and injected
// on purpose: `src/features/auth` does not import `src/services/airtable`, so its rules stay
// testable without a network or a request scope. This is the adapter both callers pass in.

import type { LandingEvent } from '@/features/auth/landing'
import { getEvent } from '@/services/airtable/queries'

/**
 * The event's status and slug, or `undefined` if it cannot be read.
 *
 * Swallowing the failure is deliberate and narrow. A membership can outlive its event, and
 * `getEvent` is a direct record fetch that Airtable answers 404 for, so a throw here would
 * replace a working landing with an error page. The caller ranks a missing event last and
 * falls back to addressing it by record id, which still resolves.
 *
 * Cached and tagged `event:{id}`, so ranking a handful of memberships costs cache hits.
 */
export async function readLandingEvent(eventId: string): Promise<LandingEvent | undefined> {
  try {
    const event = await getEvent(eventId)
    return { status: event.status, slug: event.slug }
  } catch {
    return undefined
  }
}
