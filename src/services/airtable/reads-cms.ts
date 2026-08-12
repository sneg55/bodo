// Reads for CmsEmbeds. R9's list, its editor, and the public feed.
//
// `CmsEmbeds.event` is a LINK, so the event-scoped read filters in code through
// `listByEvent` for the reason the top of reads.ts gives: an Airtable formula sees a linked
// record as its primary field's text, so `{event} = 'recABC'` matches nothing at all.
// `publicId` is real text, so the public read does filter server side, through `findByText`,
// which quotes the value (formula.ts: an unescaped apostrophe makes Airtable ignore the
// filter and hand back the whole table, which here would resolve a bogus embed id to
// whichever embed happens to sort first).
//
// The cached/uncached split is the same one reads-resources.ts explains. Both page reads are
// cached and tagged, so neither an organizer opening the list nor a visitor loading somebody
// else's website costs an Airtable round trip. `getCmsEmbed` is NOT cached: it is what the
// write path uses to check that a posted record id belongs to the event the caller was
// authorized for, and a cached answer there authorizes against a row's old event link.

import { getClient } from '@/services/airtable/client'
import { mapCmsEmbed } from '@/services/airtable/mapping-cms'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { findByText, listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { embedPublicTag, eventEmbedsTag } from '@/services/airtable/tags-cms'
import type { CmsEmbed } from '@/types/cms'

/**
 * Every embed on the event, enabled and disabled alike.
 *
 * Unfiltered on purpose: ref 32's segmented filter has a `Disabled` tab with its own count,
 * so the disabled rows ARE the list's content and filtering them out here would make that
 * count unreachable. Whether an embed is served is decided by the public read below.
 */
export async function listCmsEmbeds(eventId: string): Promise<readonly CmsEmbed[]> {
  return await listByEvent(TABLES.cmsEmbeds, eventId, mapCmsEmbed, {
    // Sorted server-side so pagination is stable across pages; the list page applies the
    // grouping and the total order the UI needs (@/features/cms/list-model).
    sort: [{ field: COL.name, direction: 'asc' }],
    cache: { tags: [eventEmbedsTag(eventId)], revalidate: REVALIDATE.edited },
  })
}

/**
 * One embed by the id in its public URL. Absent is a normal answer.
 *
 * `undefined` rather than a throw, because the caller is a public route where an unknown id
 * is a 404 and not an error worth an id and a log line. It also does NOT filter on `enabled`:
 * the route has to tell "no such embed" from "this embed is switched off" to answer both with
 * the same 404 while logging neither, and a read that hid the disabled row would make the two
 * indistinguishable here as well.
 */
export async function getCmsEmbedByPublicId(publicId: string): Promise<CmsEmbed | undefined> {
  const record = await findByText(TABLES.cmsEmbeds, COL.publicId, publicId, {
    tags: [embedPublicTag(publicId)],
    revalidate: REVALIDATE.edited,
  })
  return record === undefined ? undefined : mapCmsEmbed(record)
}

/**
 * One embed by record id, uncached, for the write path.
 *
 * Every mutation reads it to verify the row belongs to the event the caller holds a role on.
 * That decision must not come from a cache: an embed re-parented between the two would be
 * authorized against the event it used to belong to.
 */
export async function getCmsEmbed(embedId: string): Promise<CmsEmbed> {
  return mapCmsEmbed(await getClient().getRecord(TABLES.cmsEmbeds, embedId))
}
