// Writes for PortalItems, the exposure gate. BUILD_SPEC 5.0c.
//
// **What this is not.** PortalItems decides what a portal SHOWS and in what order. It never
// decides who owes anything: that is `TaskAssignments` and `FileRequestAssignments`, fanned
// out per (task, speaker, submission) by `features/assignments/fanout.ts` at accept time.
// Nothing in this file creates or deletes an assignment, and nothing it writes may be read
// as evidence that one exists. An enabled row shows a speaker only what they are already
// assigned; a disabled row hides the surface from everybody regardless of assignment.
//
// Separate from `mutations-resources.ts`, which owns the ONE PortalItems row behind a
// resource page and upserts it as part of saving that page. This file is the other caller:
// the portal editor, writing rows across all four kinds for one portal at a time. They share
// the field builders in `to-fields-resources.ts` deliberately (its header, and
// `to-fields-portals.ts`'s, both give the reason: two builders for one table is how a column
// ends up written by one save path and not the other).
//
// Batching is the client's. `createRecords` and `updateRecords` chunk at 10, which is
// Airtable's ceiling (§3.1), so nothing here re-implements it.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { TABLES } from '@/services/airtable/tables'
import { eventPortalsTag } from '@/services/airtable/tags'
import { portalItemFields, portalItemUpdateFields } from '@/services/airtable/to-fields-resources'
import type { RecordId } from '@/types/domain'
import type { PortalItemType } from '@/types/resources'

/** A row that does not exist yet: the surface, and the state the organizer just chose. */
export type PortalItemCreate = {
  itemType: PortalItemType
  /** The task, form, file request or resource this row is about. */
  itemId: RecordId
  enabled: boolean
  order: number
}

/**
 * A row that already exists, addressed by its own record id.
 *
 * `portalId` is present only for the pre-5.0c BACKFILL: rows written before portals were
 * plural carry no `portal` link, a reader resolves those to the event's default portal
 * (types/resources.ts), and the first save that touches one is where the link is finally
 * written. `portalItemUpdateFields` omits the key when this is absent and offers no way to
 * clear it, so an ordinary toggle cannot drag a row onto another portal.
 */
export type PortalItemPatch = {
  id: RecordId
  enabled: boolean
  order: number
  portalId?: RecordId
}

/**
 * Apply one portal editor save.
 *
 * Creates first, then patches, and the order is not arbitrary: a create can only ADD a
 * surface that was already visible by default (a task with no row is shown, per §5.0c's
 * absence asymmetry), while a patch is what turns something off. Failing between the two
 * therefore leaves the portal showing more than the organizer asked for rather than less,
 * and a portal that is too generous is a mistake they can see and fix, whereas one that
 * silently hid a task looks like the task was never assigned.
 *
 * `finally` on the invalidation for the reason `updateResource` gives: a call that threw
 * after Airtable committed part of the batch is still a change, and leaving the cache
 * holding the pre-write snapshot means the next reader sees a portal that no longer exists
 * in the base.
 */
export async function writePortalItems(
  input: {
    eventId: RecordId
    /** The portal every created row is linked to. Verified by the caller against the event. */
    portalId: RecordId
    creates: readonly PortalItemCreate[]
    patches: readonly PortalItemPatch[]
  },
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (input.creates.length === 0 && input.patches.length === 0) return

  const client = getClient()
  try {
    if (input.creates.length > 0) {
      await client.createRecords(
        TABLES.portalItems,
        input.creates.map((row) => portalItemFields(draftFor(input, row))),
      )
    }
    if (input.patches.length > 0) {
      await client.updateRecords(
        TABLES.portalItems,
        input.patches.map((patch) => ({
          id: patch.id,
          fields: portalItemUpdateFields({
            enabled: patch.enabled,
            order: patch.order,
            portalId: patch.portalId,
          }),
        })),
      )
    }
  } finally {
    invalidate(origin, { own: [eventPortalsTag(input.eventId)] })
  }
}

// There is deliberately no `deletePortalItems` here, and the absence is the decision. The
// editor turns a surface OFF rather than removing its row, because deleting is not the
// opposite of disabling on this table: deleting a `resource` row hides the page, while
// deleting a `task` row SHOWS the task again (the absence asymmetry in
// `features/portal-config/content.ts`). The one place rows really are removed is
// `deletePortal`, which deletes a whole portal's rows before the portal itself so an
// orphaned row cannot fall back onto the default portal, and it does that inline.

/**
 * The create row as the shared builder wants it: the source id routed to the link its
 * `itemType` names, and every other link left unset.
 *
 * The routing is repeated here rather than pushed onto the caller, because a caller that
 * fills in `taskId` beside `itemType: 'form'` is writing a row that publishes nothing and
 * reads as a form on every screen. One place decides which link a kind means.
 */
function draftFor(
  input: { eventId: RecordId; portalId: RecordId },
  row: PortalItemCreate,
): Parameters<typeof portalItemFields>[0] {
  return {
    eventId: input.eventId,
    portalId: input.portalId,
    itemType: row.itemType,
    taskId: row.itemId,
    formId: row.itemId,
    fileRequestId: row.itemId,
    resourceId: row.itemId,
    enabled: row.enabled,
    order: row.order,
  }
}
