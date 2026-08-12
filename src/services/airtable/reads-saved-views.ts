// Live reads for SavedViews. BUILD_SPEC section 3.
//
// SavedViews is keyed by a LINK to Events, so the "filter in code, not in a formula" rule
// at the top of reads.ts applies: `listByEvent` pages the table to completion and compares
// the mapped `eventId`. The surface filter happens after the map for the same reason, since
// it is a select and a formula over it would still have to page the table anyway.
//
// The cached/uncached split is the one reads-resources.ts explains. The list a page renders
// is cached and tagged, so opening Abstracts costs no extra Airtable round trip. The write
// path reads UNCACHED: making one view the default means clearing the flag on whichever
// other rows currently hold it, and deciding that from a cached list is how an event ends
// up with two defaults and a surface that opens on a different view each reload.

import { getClient } from '@/services/airtable/client'
import { mapSavedView } from '@/services/airtable/mapping-saved-views'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { TABLES } from '@/services/airtable/tables'
import { eventSavedViewsTag } from '@/services/airtable/tags'
import type { SavedView, SavedViewSurface } from '@/types/saved-views'

/**
 * Every saved view on one surface of one event.
 *
 * Unsorted here on purpose: `sortSavedViews` in @/features/views/saved-view-model owns the
 * order, because the same order has to hold for the fixture path and for a list an action
 * just read back, and a sort declared in two places drifts.
 */
export async function listSavedViews(
  eventId: string,
  surface: SavedViewSurface,
): Promise<readonly SavedView[]> {
  const rows = await listByEvent(TABLES.savedViews, eventId, mapSavedView, {
    cache: { tags: [eventSavedViewsTag(eventId)], revalidate: REVALIDATE.edited },
  })
  return rows.filter((row) => row.surface === surface)
}

/**
 * The same list, uncached, for the write path.
 *
 * Used by the create and set-default writes: both need to know which names are taken and
 * which row currently holds the default flag, and a cached answer there duplicates a name
 * or leaves a second default behind.
 */
export async function listSavedViewsUncached(
  eventId: string,
  surface: SavedViewSurface,
): Promise<readonly SavedView[]> {
  const rows = await listByEvent(TABLES.savedViews, eventId, mapSavedView)
  return rows.filter((row) => row.surface === surface)
}

/**
 * One view by record id, uncached.
 *
 * The apply, default and delete actions read it to verify the row belongs to the event they
 * were authorized for. A cached answer there would authorize against a row's old event link.
 */
export async function getSavedView(viewId: string): Promise<SavedView> {
  return mapSavedView(await getClient().getRecord(TABLES.savedViews, viewId))
}
