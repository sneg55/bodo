// The composed reads behind R8's two surfaces.
//
// Both sides read the same two cached, tagged lists through
// `@/services/airtable/queries` and then apply the pure rule in ./pages. Nothing here
// filters in a formula and nothing here caches: the cache is on the request, in
// reads-resources.ts.
//
// The portal reads call `requireSpeaker()` themselves rather than trusting
// `(portal)/portal/layout.tsx`. That layout redirects a browser, which is a convenience,
// not a boundary: BUILD_SPEC 4 is explicit that a Next app has several entry points and a
// layout does not re-run on every navigation. Since these reads are what put unsanitized
// organizer HTML on a page, the check belongs next to the read.

import { requireSpeaker } from '@/features/auth/wiring'
import { portalEventIds } from '@/features/portal/event-scope'
import {
  adminResourceEntries,
  findResourceBySlug,
  type ResourceEntry,
  speakerResources,
} from '@/features/resources/pages'
import { listPortalItems, listResources } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { Resource } from '@/types/resources'

/** Both lists together, because visibility is the join between them. */
async function loadPair(eventId: string) {
  // In parallel: they are two independent cached reads sharing one tag, and running them
  // in series would double the cold-start latency of every resource page.
  const [resources, items] = await Promise.all([listResources(eventId), listPortalItems(eventId)])
  return { resources, items }
}

/** Every resource on the event, draft included, for the admin list. Authorized above. */
export async function readAdminResources(eventId: RecordId): Promise<readonly ResourceEntry[]> {
  const { resources, items } = await loadPair(eventId)
  return adminResourceEntries(eventId, resources, items)
}

/** One resource by record id, with its publishing row, for the editor. */
export async function readAdminResource(
  eventId: RecordId,
  resourceId: RecordId,
): Promise<ResourceEntry | undefined> {
  const entries = await readAdminResources(eventId)
  return entries.find((entry) => entry.resource.id === resourceId)
}

/**
 * The pages the acting speaker may open.
 *
 * Reads the whole event's lists and filters in code, which is the same trade the rest of
 * the portal makes (see the header of @/features/portal/reads): one cached, tagged read
 * serves every speaker instead of one uncacheable read per visitor.
 *
 * Across every event the speaker is on, and per event rather than widened, for the reason
 * `readOwnRequestedFiles` gives: these reads are tagged `event:{id}:resources` and there is
 * no cross-event form of them, so N correctly tagged reads is the only shape a write can
 * still invalidate. It is one call in the ordinary case. Scoping this to `PORTAL_EVENT_ID`
 * showed a speaker one organizer's pages and silently hid the other's, and the pill was
 * absent entirely for a speaker who is not on the configured event.
 *
 * A slug that two events both use resolves to the first in the speaker's scope. That is the
 * same first-match-wins the portal ordering already relies on, and the alternative is a
 * disambiguating URL segment the parity docs do not have.
 */
export async function readPortalResources(): Promise<readonly Resource[]> {
  const { speakerId } = await requireSpeaker()
  const eventIds = await portalEventIds(speakerId)

  const perEvent = await Promise.all(
    eventIds.map(async (eventId) => {
      const { resources, items } = await loadPair(eventId)
      return speakerResources(eventId, resources, items)
    }),
  )

  return perEvent.flat()
}

/**
 * One page a speaker asked for by slug, or `undefined` for the 404.
 *
 * Resolved out of the VISIBLE list, never out of the full one. That is the whole
 * enforcement: a draft page cannot be reached by guessing its URL, because it was never a
 * candidate to match against.
 */
export async function readPortalResource(slug: string): Promise<Resource | undefined> {
  return findResourceBySlug(await readPortalResources(), slug)
}

/** True when the event has at least one page a speaker can open. */
export async function hasPortalResources(): Promise<boolean> {
  return (await readPortalResources()).length > 0
}
