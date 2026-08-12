// Writes for Portals. BUILD_SPEC 5.0c.
//
// Same posture as the rest of the write side: no fixture branch, and `getClient()` throws
// CFG_ENV_MISSING with no base configured, because a portal that reports success and stores
// nothing is worse than one that fails.
//
// What is different about this table is that its rows are not independent of each other.
// `order` is an ordered list the matcher walks first-match-wins, and `isDefault` is an
// exactly-one-per-event invariant that Airtable cannot express. Neither is checkable on a
// single row, so every function here either reads the event's portals uncached first
// (reads-portals.ts explains why cached would be wrong) or writes a column that cannot break
// them.
//
// The invariant itself is enforced in `savePortal` in `src/features/portal-config`, which is
// where the two-row default handover belongs: it is a decision over the whole list, and this
// file writes rows. The ONE guard that lives here is the refusal to delete a default portal,
// and it is here because this is the last place that can still see the flag. Anything past
// this point is an HTTP call that has already committed.
//
// Every function ends in invalidate.ts, which owns what expiring a tag means. Batching is
// the client's: `createRecords`, `updateRecords` and `deleteRecords` all chunk at 10 (§3.1)
// internally, so nothing here re-implements it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapPortal } from '@/services/airtable/mapping-portals'
import { getPortal } from '@/services/airtable/reads-portals'
import { listPortalItemsUncached } from '@/services/airtable/reads-resources'
import { TABLES } from '@/services/airtable/tables'
import { eventPortalsTag } from '@/services/airtable/tags'
import {
  type PortalDraft,
  type PortalUpdate,
  portalFields,
  portalOrderFields,
  portalUpdateFields,
} from '@/services/airtable/to-fields-portals'
import type { RecordId } from '@/types/domain'
import type { Portal } from '@/types/portals'

export async function createPortal(
  draft: PortalDraft,
  origin: WriteOrigin = 'action',
): Promise<Portal> {
  const created = await getClient().createRecords(TABLES.portals, [portalFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Portals: write returned no record', {
      table: TABLES.portals,
      name: draft.name,
    })
  }

  const portal = mapPortal(record)
  invalidate(origin, { own: [eventPortalsTag(portal.eventId)] })
  return portal
}

/**
 * One portal's own row: name, kind, filters, position, default flag and settings.
 *
 * `eventId` is taken as a parameter rather than read back off the row, and it is the event
 * the CALLER was authorized for. It is used for the tag alone, never written (the update
 * builder does not send the event link), so passing the wrong one expires the wrong cache
 * rather than re-parenting a portal.
 *
 * `finally` on the invalidation for the reason `updateResource` gives: a write that failed
 * after Airtable committed it is still a change, and leaving the cache holding the pre-write
 * snapshot means the next reader sees a list that no longer exists in the base. On this
 * table that reader is the matcher.
 */
export async function updatePortal(
  input: {
    portalId: RecordId
    /** Verified by the caller against the acting organizer's event. */
    eventId: RecordId
    update: PortalUpdate
  },
  origin: WriteOrigin = 'action',
): Promise<void> {
  try {
    await getClient().updateRecords(TABLES.portals, [
      { id: input.portalId, fields: portalUpdateFields(input.update) },
    ])
  } finally {
    invalidate(origin, { own: [eventPortalsTag(input.eventId)] })
  }
}

/**
 * Delete a portal and the rows that published content into it.
 *
 * Two guards, both read from the record itself rather than trusted from the caller, because
 * a flag passed in is a flag the caller could have read before somebody else changed it:
 *
 *   - The row must belong to the event the caller was authorized for. Without this, a portal
 *     id from another conference deletes cleanly and expires the wrong tag.
 *   - The DEFAULT portal cannot be deleted. It is where every contact matching no filter
 *     lands, so deleting it does not remove a portal, it removes the floor: contacts with no
 *     match then have nowhere to go, and the failure surfaces as speakers seeing an empty
 *     portal rather than as anything an organizer did. §5.0c states the same rule for the
 *     list screen's menu, and it is repeated here because a menu is not an authorization
 *     boundary and this is the last place the flag is still visible.
 *
 * The PortalItems rows go FIRST, and this ordering is the one non-obvious part. Airtable
 * clears a link when its target is deleted rather than cascading, so deleting the portal
 * first would leave its item rows with an EMPTY `portal` link, and an empty link is read as
 * "the event's default portal" (types/resources.ts). Every page and task the organizer had
 * scoped to this portal would therefore reappear on the default portal, published, in front
 * of every contact at the conference. Deleting the rows first means the worst partial
 * failure is a portal that still exists with less content in it.
 */
export async function deletePortal(
  input: { portalId: RecordId; eventId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const portal = await getPortal(input.portalId)
  if (portal.eventId !== input.eventId) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Portals: portal belongs to another event', {
      table: TABLES.portals,
      portalId: input.portalId,
      eventId: input.eventId,
    })
  }
  if (portal.isDefault) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Portals: the default portal cannot be deleted', {
      table: TABLES.portals,
      portalId: input.portalId,
    })
  }

  const client = getClient()
  const items = await listPortalItemsUncached(input.eventId)
  const owned = items.filter((item) => item.portalId === input.portalId).map((item) => item.id)
  if (owned.length > 0) await client.deleteRecords(TABLES.portalItems, owned)

  try {
    await client.deleteRecords(TABLES.portals, [input.portalId])
  } finally {
    invalidate(origin, { own: [eventPortalsTag(input.eventId)] })
  }
}

/**
 * Dense-renumber the event's portals from 0, in the order given.
 *
 * Dense rather than sparse, and from 0 rather than from whatever the rows held, because a
 * tie here is a correctness bug and not a display one: two portals sharing a number make a
 * contact's portal depend on the order Airtable happened to paginate them in, which is
 * stable enough to look fine and unstable enough to change on the next read. Renumbering
 * every row on every save is the only version of this with no arithmetic to get wrong.
 *
 * Only `order` is written (`portalOrderFields`), so a drag cannot revert a filter edit
 * somebody made in another tab.
 *
 * There is deliberately NO guard here on where the default portal may sit. §5.0c says the
 * default "cannot be deleted or reordered below a custom one" while also making it the row
 * every unmatched contact falls through to, and those two readings put it at opposite ends
 * of the list. That is a question for the list screen and `match.ts`, which is where the
 * matcher's own semantics are decided; encoding a guess here would silently reject a
 * legitimate drag with no way to tell which reading rejected it.
 */
export async function reorderPortals(
  input: { eventId: RecordId; portalIds: readonly RecordId[] },
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (input.portalIds.length === 0) return

  const patches = input.portalIds.map((id, index) => ({ id, fields: portalOrderFields(index) }))
  try {
    await getClient().updateRecords(TABLES.portals, patches)
  } finally {
    invalidate(origin, { own: [eventPortalsTag(input.eventId)] })
  }
}
