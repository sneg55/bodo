// `event-ref.ts` wired to the data layer, in the one place that is allowed to do it.
//
// Split from the rule next door for the reason `wiring.ts` is split from `guards.ts`: the
// rule is pure and unit tested, and the read is resolved exactly once so no call site can
// wire it differently.
//
// **Every caller that reads or authorizes uses the RECORD ID this returns.** Every caller
// that builds a link keeps using the ref it was handed. That is what makes the whole change
// cheap: the 64 places that interpolate `/admin/${eventId}/...` all interpolate a value they
// were given, so handing them a slug produces slug URLs with no edit to any of them.

import { notFound } from 'next/navigation'

import { resolveEventRefWith } from '@/features/events/event-ref'
import { getEventBySlug } from '@/services/airtable/queries'

/** The record id an event ref names, or `undefined` when no event holds that slug. */
export async function resolveEventRef(ref: string): Promise<string | undefined> {
  return await resolveEventRefWith(ref, getEventBySlug)
}

/**
 * The record id for a page body, 404ing on a slug no event holds.
 *
 * **Call this in the page BODY**, which is where every caller does. `notFound()` reached
 * from inside a Suspense boundary renders the 404 page after the status line has gone out,
 * so the response is HTTP 200 carrying the 404 body. Every admin route keeps a `loading.tsx`
 * on purpose, so that is the cost here too, and `.claude/rules/bodo-conventions.md` already
 * records it as accepted for admin `[id]` routes rather than discovered here.
 *
 * A REC-ID ref never reaches the lookup, so a bogus record id behaves exactly as it did
 * before this function existed. That is deliberate: this change is not allowed to alter what
 * any URL that worked yesterday does today.
 */
export async function requireEventId(ref: string): Promise<string> {
  const id = await resolveEventRef(ref)
  if (id === undefined) notFound()
  return id
}
