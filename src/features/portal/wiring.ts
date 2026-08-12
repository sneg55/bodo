// Where the portal's data port meets the data layer.
//
// `ports.ts` declares the shape and keeps a deliberately-refusing default so the
// feature can be built and unit tested without a DAL. This file resolves that
// indirection exactly once, and it lives here rather than in `ports.ts` for two
// reasons: importing a service from the module that defines the port would point a
// feature at the implementation it exists to abstract, and installing it as a
// module-level side effect of `ports.ts` would make the refusing default unobservable,
// so the tests describing what a port has to promise would have nothing left to test.
//
// Same shape as `@/features/auth/wiring`, which resolves the membership-loader seam.
// Import this from a portal route, once, near the top.

import { setPortalDataPort } from '@/features/portal/ports'
import { airtablePortalDataPort } from '@/services/airtable/portal-port'

let installed = false

/**
 * Idempotent, because every portal route calls it and only the first matters.
 *
 * Named `install...` rather than `use...` deliberately: a `use` prefix makes React's
 * lint treat it as a hook and refuse to let an async server component call it.
 */
export function installPortalData(): void {
  if (installed) return
  setPortalDataPort(airtablePortalDataPort)
  installed = true
}
