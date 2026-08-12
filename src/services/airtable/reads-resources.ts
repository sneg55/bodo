// Live reads for Resources and PortalItems. SPEC.md R8, BUILD_SPEC 5.8.
//
// Both tables are keyed by a LINK to Events, so the "filter in code, not in a formula"
// rule from the top of reads.ts applies: `listByEvent` pages the table to completion and
// compares the mapped `eventId`.
//
// The cached/uncached split is the same one reads-portal.ts explains, and it matters here
// for one specific reason. The page reads are cached and tagged, so a speaker opening a
// resource costs no Airtable round trip. The SLUG read is not one of them: the save action
// reads the event's existing slugs to de-duplicate the one it is about to write, and a
// cached list there would hand it a stale set and let two pages share a URL. So that read
// passes no `ReadCache`, which `cacheInit` turns into an explicit `no-store`.

import { getClient } from '@/services/airtable/client'
import { mapPortalItem, mapResource } from '@/services/airtable/mapping-resources'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventResourcesTag } from '@/services/airtable/tags'
import type { PortalItem, Resource } from '@/types/resources'

/**
 * Both tables behind one tag and one window.
 *
 * The two reads are always issued together, because visibility is the join between them
 * (@/features/resources/pages), so giving them one cache identity keeps them from
 * expiring independently and briefly disagreeing about whether a page is published.
 */
function resourcesCache(eventId: string): ReadCache {
  return { tags: [eventResourcesTag(eventId)], revalidate: REVALIDATE.edited }
}

export async function listResources(eventId: string): Promise<readonly Resource[]> {
  return await listByEvent(TABLES.resources, eventId, mapResource, {
    // Sorted server-side as well as in the feature: the sort here keeps pagination stable
    // across pages, and @/features/resources/pages applies the total order the UI needs.
    sort: [{ field: COL.order, direction: 'asc' }],
    cache: resourcesCache(eventId),
  })
}

export async function listPortalItems(eventId: string): Promise<readonly PortalItem[]> {
  return await listByEvent(TABLES.portalItems, eventId, mapPortalItem, {
    sort: [{ field: COL.order, direction: 'asc' }],
    cache: resourcesCache(eventId),
  })
}

/**
 * Every slug on the event, uncached, for the de-duplication in the save action.
 *
 * Uncached deliberately. Deciding what to WRITE from a cached read is how two resources
 * end up sharing a URL: the second save would not see the first one's slug and
 * `uniqueSlug` would hand back a value that is already taken.
 */
export async function listResourceSlugs(eventId: string): Promise<readonly string[]> {
  const rows = await listByEvent(TABLES.resources, eventId, mapResource, {
    // No `cache` key at all, which cacheInit turns into `no-store`.
  })
  return rows.map((row) => row.slug)
}

/**
 * One resource by record id, uncached.
 *
 * The save and delete actions read it to verify the record belongs to the event they were
 * authorized for. A cached answer there would authorize against a row's old event link.
 */
export async function getResource(resourceId: string): Promise<Resource> {
  return mapResource(await getClient().getRecord(TABLES.resources, resourceId))
}

/**
 * The event's PortalItems rows, uncached, for the write path.
 *
 * The save action needs to know whether this resource already has a publishing row, and
 * whether to create or update it. Reading that from cache creates a duplicate row on the
 * second save.
 */
export async function listPortalItemsUncached(eventId: string): Promise<readonly PortalItem[]> {
  return await listByEvent(TABLES.portalItems, eventId, mapPortalItem)
}
