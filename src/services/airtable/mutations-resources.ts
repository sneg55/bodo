// Writes for Resources and its PortalItems row. SPEC.md R8, BUILD_SPEC 5.8.
//
// Same posture as the rest of the write side: no fixture branch, and `getClient()` throws
// CFG_ENV_MISSING with no base configured, because a resource page that reports success
// and stores nothing is worse than one that fails.
//
// A resource is TWO rows and they are saved together. The Resources row is the content;
// the PortalItems row is whether a speaker can see it and where it sits in the order. They
// are written in that sequence for a reason: the item links TO the resource, so a create
// needs the resource id first, and a failure between the two leaves a draft page (content
// stored, not published) rather than a published row pointing at nothing.
//
// Every function here ends in invalidate.ts, which owns what expiring a tag means.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapResource } from '@/services/airtable/mapping-resources'
import { listPortalItemsUncached } from '@/services/airtable/reads-resources'
import { TABLES } from '@/services/airtable/tables'
import { eventResourcesTag } from '@/services/airtable/tags'
import {
  portalItemFields,
  portalItemUpdateFields,
  type ResourceDraft,
  type ResourceEdit,
  resourceEditFields,
  resourceFields,
} from '@/services/airtable/to-fields-resources'
import type { RecordId } from '@/types/domain'
import type { Resource } from '@/types/resources'

/** Whether the page is published, and where it sits. Written to PortalItems. */
export type ResourcePublication = {
  enabled: boolean
  order: number
}

export async function createResource(
  input: { draft: ResourceDraft; publication: ResourcePublication },
  origin: WriteOrigin = 'action',
): Promise<Resource> {
  const created = await getClient().createRecords(TABLES.resources, [resourceFields(input.draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Resources: write returned no record', {
      table: TABLES.resources,
      slug: input.draft.slug,
    })
  }

  const resource = mapResource(record)
  await writePublication(resource, input.publication)
  invalidate(origin, { own: [eventResourcesTag(resource.eventId)] })
  return resource
}

/**
 * Content and publication, ordered so a partial failure cannot expose a state a speaker
 * should not see, and invalidating even when it does fail.
 *
 * Two Airtable tables and no transaction, so the question is not whether a write can fail
 * halfway but which half to do first. Closing the gate BEFORE changing content and opening
 * it AFTER means the visible-to-speakers window only ever narrows on failure: an
 * unpublish that dies after the item write leaves the old content hidden, and a publish that
 * dies after the content write leaves new content unpublished. The other order would show
 * half-edited content, or content the organizer had just removed. Found by Codex review.
 *
 * `finally` on the invalidation because a committed first write with a failed second is
 * still a change: leaving the cache holding the pre-write snapshot is how the next reader
 * sees a state that no longer exists in the base.
 */
export async function updateResource(
  input: {
    resourceId: RecordId
    /** Verified by the caller against the acting organizer's event. */
    eventId: RecordId
    edit: ResourceEdit
    publication: ResourcePublication
  },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const target = { id: input.resourceId, eventId: input.eventId }
  try {
    if (!input.publication.enabled) await writePublication(target, input.publication)
    await getClient().updateRecords(TABLES.resources, [
      { id: input.resourceId, fields: resourceEditFields(input.edit) },
    ])
    if (input.publication.enabled) await writePublication(target, input.publication)
  } finally {
    invalidate(origin, { own: [eventResourcesTag(input.eventId)] })
  }
}

/**
 * Publication only, leaving the content alone.
 *
 * The list page's toggle used to round-trip every content field it had just read, which is a
 * lost update: an organizer editing the page in between had their edit reverted by somebody
 * else pressing Publish, and HTML they had deliberately REMOVED came back. Found by Codex
 * review. This still upserts a missing row, which is the reason the toggle went through the
 * content path in the first place.
 */
export async function setResourcePublication(
  input: { resourceId: RecordId; eventId: RecordId; publication: ResourcePublication },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await writePublication({ id: input.resourceId, eventId: input.eventId }, input.publication)
  } finally {
    invalidate(origin, { own: [eventResourcesTag(input.eventId)] })
  }
}

/**
 * Delete the page and the row that published it.
 *
 * The PortalItems row goes FIRST. Airtable clears a link when its target is deleted rather
 * than cascading, so deleting the resource first would leave an enabled portal item with no
 * resource behind it, and although `speakerResources` skips a row whose `resourceId` is
 * absent, relying on that to hide an orphan is relying on a reader to clean up after a
 * writer. Deleting in this order means there is never an interval where one exists without
 * the other in a way a speaker could observe.
 */
export async function deleteResource(
  input: { resourceId: RecordId; eventId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const client = getClient()
  const existing = await findItem(input.eventId, input.resourceId)
  if (existing !== undefined) {
    await client.deleteRecords(TABLES.portalItems, [existing])
  }
  try {
    await client.deleteRecords(TABLES.resources, [input.resourceId])
  } finally {
    invalidate(origin, { own: [eventResourcesTag(input.eventId)] })
  }
}

/**
 * Create or update the one PortalItems row for this resource.
 *
 * An upsert rather than a create, because the editor saves repeatedly and a create per
 * save would leave a resource with five publishing rows, of which `speakerResources` would
 * pick one deterministically and the organizer would have four invisible ones to toggle.
 */
async function writePublication(
  resource: Pick<Resource, 'id' | 'eventId'>,
  publication: ResourcePublication,
): Promise<void> {
  const client = getClient()
  const existing = await findItem(resource.eventId, resource.id)

  if (existing === undefined) {
    await client.createRecords(TABLES.portalItems, [
      portalItemFields({
        eventId: resource.eventId,
        itemType: 'resource',
        resourceId: resource.id,
        enabled: publication.enabled,
        order: publication.order,
      }),
    ])
    return
  }

  await client.updateRecords(TABLES.portalItems, [
    { id: existing, fields: portalItemUpdateFields(publication) },
  ])
}

/** The record id of this resource's publishing row, or `undefined`. Uncached read. */
async function findItem(eventId: RecordId, resourceId: RecordId): Promise<RecordId | undefined> {
  const items = await listPortalItemsUncached(eventId)
  return items.find((item) => item.itemType === 'resource' && item.resourceId === resourceId)?.id
}
