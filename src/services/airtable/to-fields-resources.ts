// App input to an Airtable field set, for Resources and PortalItems.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one
// id, `null` CLEARS a column, and an ABSENT key leaves the old value in place. Which of
// the last two applies is a decision per column, so each one below says which it made.
//
// The decision that matters here is that `bodyMarkdown` and `embedHtml` are always
// present in an update and carry `null` when empty. An organizer who deletes the embed
// out of the textarea and presses Save means it. An omitted key would leave the old embed
// on the page, which is the one direction that cannot be undone from the UI: the field
// would look empty in the editor and still be rendering to speakers.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { PortalItem, Resource } from '@/types/resources'

export type ResourceDraft = {
  eventId: RecordId
  title: string
  /** Already validated and de-duplicated by @/features/resources/slug. */
  slug: string
  bodyMarkdown?: string
  /** Raw organizer markup. Stored verbatim; isolated at render, never sanitized. */
  embedHtml?: string
  visibility: Resource['visibility']
  order: number
}

/**
 * A new Resources row.
 *
 * `compact`, so an absent body or embed is simply not sent: there is no previous value to
 * leave in place on a create, and sending `null` into a column that has never held a
 * value is noise at best.
 */
export function resourceFields(draft: ResourceDraft): FieldSet {
  return compact({
    [COL.title]: draft.title,
    [COL.event]: link(draft.eventId),
    [COL.slug]: draft.slug,
    [COL.bodyMarkdown]: draft.bodyMarkdown,
    [COL.embedHtml]: draft.embedHtml,
    [COL.visibility]: draft.visibility,
    [COL.order]: draft.order,
  })
}

export type ResourceEdit = Omit<ResourceDraft, 'eventId'>

/**
 * An edit to an existing row.
 *
 * The event link is NOT sent. A resource does not change events, and re-sending the link
 * on every save would make a mis-passed event id a silent re-parenting rather than a
 * failed write. The two long-text columns carry `null` when empty; see the header.
 */
export function resourceEditFields(edit: ResourceEdit): FieldSet {
  return {
    [COL.title]: edit.title,
    [COL.slug]: edit.slug,
    [COL.bodyMarkdown]: emptyToNull(edit.bodyMarkdown),
    [COL.embedHtml]: emptyToNull(edit.embedHtml),
    [COL.visibility]: edit.visibility,
    [COL.order]: edit.order,
  }
}

export type PortalItemDraft = {
  eventId: RecordId
  /**
   * Which portal exposes the row. Optional, and the optionality is the same migration state
   * `types/resources.ts` describes rather than a choice: `createResource` writes a
   * publishing row before any portal has been picked, and a reader treats an absent link as
   * the event's default portal. Required here would mean either failing that create or
   * having it guess a portal id, and guessing is how a page appears on a portal nobody
   * assigned it to. BUILD_SPEC 5.0c.
   */
  portalId?: RecordId
  itemType: PortalItem['itemType']
  /**
   * The source record, as the ONE link `itemType` names. Exactly one of the four is ever
   * set, and which one is not checkable in the type system, so `portalItemFields` sends
   * only the link matching `itemType` and ignores the rest.
   *
   * The other three arrived with the portal editor (BUILD_SPEC 5.0c), which writes rows for
   * all four kinds rather than for resources alone. They are added HERE rather than in a
   * second builder next to the portal mutations, because `to-fields-portals.ts` states the
   * rule in its own header: two builders for one table is how a column ends up written by
   * one save path and not the other, which on PortalItems would be a row that publishes into
   * whichever portal the caller happened to reach for.
   */
  taskId?: RecordId
  formId?: RecordId
  fileRequestId?: RecordId
  resourceId?: RecordId
  enabled: boolean
  order: number
}

/**
 * A PortalItems row.
 *
 * Only the link `itemType` names is written. The other three are left alone rather than
 * nulled, because `itemType` is what says which link is meaningful and a task row has no
 * business clearing a resource column. On a create there is nothing to clear anyway, and on
 * the day this builder is reused for an edit that asymmetry is what keeps a mis-typed row
 * from silently unpublishing a page of another kind.
 *
 * `enabled` is always sent, including `false`. It is the flag a speaker's access depends
 * on, so "unchanged" is never the right reading of a save that turned it off.
 */
export function portalItemFields(draft: PortalItemDraft): FieldSet {
  return compact({
    [COL.order]: draft.order,
    [COL.event]: link(draft.eventId),
    [COL.portal]: draft.portalId === undefined ? undefined : link(draft.portalId),
    [COL.itemType]: draft.itemType,
    [COL.task]: maybeLink(draft.itemType === 'task' ? draft.taskId : undefined),
    [COL.form]: maybeLink(draft.itemType === 'form' ? draft.formId : undefined),
    [COL.fileRequest]: maybeLink(
      draft.itemType === 'file_request' ? draft.fileRequestId : undefined,
    ),
    [COL.resource]: maybeLink(draft.itemType === 'resource' ? draft.resourceId : undefined),
    [COL.enabled]: draft.enabled,
  })
}

/** A link array, or `undefined` so `compact` drops the key rather than clearing the column. */
function maybeLink(recordId: RecordId | undefined): readonly string[] | undefined {
  return recordId === undefined ? undefined : link(recordId)
}

/**
 * The state of one existing PortalItems row, without re-parenting it.
 *
 * `portalId` is optional and the key is OMITTED when it is absent, which is the one shape
 * that serves both callers. A publication toggle passes nothing and leaves the link alone,
 * because a page on three portals is three rows (§5.0c moves uniqueness from (event, item)
 * to (portal, item)) and a save on one of them must not drag the other two. The backfill
 * that gives a pre-5.0c row its event's default portal passes the id, and that is the only
 * write that ever sets this column on an existing row.
 *
 * There is deliberately no way to CLEAR the link. Clearing it would silently move the row
 * onto the default portal, which reads as an intentional assignment afterwards.
 */
export function portalItemUpdateFields(update: {
  enabled: boolean
  order: number
  portalId?: RecordId
}): FieldSet {
  return compact({
    [COL.enabled]: update.enabled,
    [COL.order]: update.order,
    [COL.portal]: update.portalId === undefined ? undefined : link(update.portalId),
  })
}

/**
 * `''` becomes `null` so the column is cleared, and `undefined` also becomes `null`.
 *
 * Both mean "the organizer left it blank" on an edit, and neither should leave a stale
 * value in place. `compact` would drop them, which is why the edit builder does not use it.
 */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value
}
