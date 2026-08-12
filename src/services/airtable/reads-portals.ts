// Live reads for Portals. BUILD_SPEC 5.0c.
//
// Portals is keyed by a LINK to Events, so the "filter in code, not in a formula" rule from
// the top of reads.ts applies: `listByEvent` pages the table to completion and compares the
// mapped `eventId`.
//
// The cached/uncached split is the one reads-portal.ts and reads-resources.ts both explain,
// and on this table it is sharper than on either. Portals is an ORDERED list whose order
// decides which portal a contact is assigned to, first match wins. A read that decides what
// to WRITE from a cached copy of that list is not slightly stale, it is deciding an
// invariant from a snapshot: `savePortal` picks create-versus-update and enforces "exactly
// one default per event" from what it reads, so a cached answer is how an event ends up with
// two default portals, and nothing downstream can tell which one is real.

import { getClient } from '@/services/airtable/client'
import { mapPortal } from '@/services/airtable/mapping-portals'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventPortalsTag } from '@/services/airtable/tags'
import type { Portal } from '@/types/portals'

/**
 * The portals, the resource pages and the PortalItems rows, all under one cache identity.
 *
 * `eventPortalsTag` is `eventResourcesTag` under another name (tags.ts says why), so this is
 * the SAME tag `listResources` and `listPortalItems` already carry, on purpose. The three
 * reads answer one question between them (which portal exposes which page), and a tag of its
 * own here would let the portal order expire while the item rows served the answer they had
 * before the drag. First-match-wins means a stale `order` is a contact in the wrong portal.
 */
function portalsCache(eventId: string): ReadCache {
  return { tags: [eventPortalsTag(eventId)], revalidate: REVALIDATE.edited }
}

/**
 * The event's portals, in assignment order.
 *
 * Sorted server-side as well as being an ordered domain concept: the sort keeps pagination
 * stable across pages, which matters more here than on any other list, because a row that
 * moved between page one and page two of the same read would come back either twice or not
 * at all, and a portal missing from the list is a portal the matcher skips.
 */
export async function listPortals(eventId: string): Promise<readonly Portal[]> {
  return await listByEvent(TABLES.portals, eventId, mapPortal, {
    sort: [{ field: COL.order, direction: 'asc' }],
    cache: portalsCache(eventId),
  })
}

/**
 * The same list, uncached, for the write path.
 *
 * Needed because `savePortal` decides create-versus-update and enforces exactly-one-default
 * from what this returns. See the header: deciding a write from a cached read is how an
 * event ends up with two defaults. The reorder needs it for the same reason, since a dense
 * renumber over a stale list writes positions for rows that have since moved.
 */
export async function listPortalsUncached(eventId: string): Promise<readonly Portal[]> {
  return await listByEvent(TABLES.portals, eventId, mapPortal, {
    // No `cache` key at all, which cacheInit turns into an explicit `no-store`.
    sort: [{ field: COL.order, direction: 'asc' }],
  })
}

/**
 * One portal by record id, uncached.
 *
 * The save and delete actions read it to verify the record belongs to the event they were
 * authorized for, and `deletePortal` reads it to see the `isDefault` box it is about to
 * refuse on. A cached answer authorizes against a row's old event link, and worse, would let
 * a portal that became the default seconds ago still be deleted on the strength of the
 * unchecked box the cache is holding.
 */
export async function getPortal(portalId: string): Promise<Portal> {
  return mapPortal(await getClient().getRecord(TABLES.portals, portalId))
}
