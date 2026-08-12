// The embed editor's writes: create, save, delete. R9, docs/parity/cms-embeds.md.
//
// TWO tags on every write, and the second one is the one that is easy to miss. The admin list
// is tagged `event:{id}:embeds`, but the served feed is read by the `publicId` in a URL that
// lives in somebody else's HTML, so it has its own `embed:{publicId}` cache entry (tags-cms.ts
// says why the pair exists). A save that expires only the event tag leaves a live embed on a
// third-party website serving the old view, and a DISABLE that expires only the event tag
// leaves it serving at all, which is the whole point of the switch. So both tags travel
// together through `expire` below and no caller names them itself.
//
// No fixture branch, like every other mutation module: `getClient()` throws CFG_ENV_MISSING
// with no base configured, because a write that reports success and stores nothing leaves an
// organizer believing a feed is switched off.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapCmsEmbed } from '@/services/airtable/mapping-cms'
import { TABLES } from '@/services/airtable/tables'
import { embedPublicTag, eventEmbedsTag } from '@/services/airtable/tags-cms'
import {
  type CmsEmbedDraft,
  type CmsEmbedEdit,
  cmsEmbedEditFields,
  cmsEmbedFields,
} from '@/services/airtable/to-fields-cms'
import type { CmsEmbed } from '@/types/cms'
import type { RecordId } from '@/types/domain'

function expire(target: { eventId: RecordId; publicId: string }, origin: WriteOrigin): void {
  invalidate(origin, {
    own: [eventEmbedsTag(target.eventId)],
    // The public feed's own cache entry, on a URL this app does not control. See the header.
    others: [embedPublicTag(target.publicId)],
  })
}

export async function createCmsEmbed(
  draft: CmsEmbedDraft,
  origin: WriteOrigin = 'action',
): Promise<CmsEmbed> {
  const created = await getClient().createRecords(TABLES.cmsEmbeds, [cmsEmbedFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'CmsEmbeds: create returned no record', {
      table: TABLES.cmsEmbeds,
      publicId: draft.publicId,
    })
  }
  expire(draft, origin)
  return mapCmsEmbed(record)
}

export type CmsEmbedChange = {
  embedId: RecordId
  /** Both verified by the caller against the acting organizer's event. */
  eventId: RecordId
  publicId: string
  edit: CmsEmbedEdit
}

/**
 * Name, view and enabled in one write.
 *
 * One write rather than one per control, because ref 33's Type section is one form and the
 * three fields are independent: a per-field write would let a rename land while the disable
 * that was submitted with it failed, and the organizer would be looking at a settings panel
 * that agrees with neither.
 *
 * `finally` on the invalidation because a failed update can still have committed: leaving the
 * cache holding the pre-write snapshot is how the next reader, on a stranger's website, sees a
 * state that no longer exists in the base.
 */
export async function updateCmsEmbed(
  change: CmsEmbedChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().updateRecords(TABLES.cmsEmbeds, [
      { id: change.embedId, fields: cmsEmbedEditFields(change.edit) },
    ])
  } finally {
    expire(change, origin)
  }
}

/**
 * Delete one embed row.
 *
 * Nothing links a CmsEmbeds row, so there is no cascade to worry about, but the public tag
 * still has to expire: the deleted embed's URL is in somebody else's HTML and would keep
 * serving from its cache entry for the rest of the window otherwise, which is a feed that
 * outlives the record it came from.
 */
export async function deleteCmsEmbed(
  target: { embedId: RecordId; eventId: RecordId; publicId: string },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().deleteRecords(TABLES.cmsEmbeds, [target.embedId])
  } finally {
    expire(target, origin)
  }
}
