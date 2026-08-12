// App input to an Airtable field set, for Portals. BUILD_SPEC 5.0c.
//
// Inherits the rule to-fields.ts exists for: a link is an ARRAY even when it holds one id,
// `null` CLEARS a column, and an ABSENT key leaves the old value in place. Which of the last
// two applies is a decision per column, so each one below says which it made and what the
// other option would have cost.
//
// The PortalItems builders are NOT here. `to-fields-resources.ts` already owns
// `portalItemFields` and `portalItemUpdateFields`, and the new `portal` link was added there
// rather than duplicated into this file: two builders for one table is how a column ends up
// written by one save path and not the other, which on this table would be a row that
// publishes into whichever portal the caller happened to reach for.
//
// The decision that matters here is `filterJson`, which is ALWAYS present on an update and
// never omitted. Clearing a portal's predicates is a real edit an organizer makes: it is how
// a portal that was targeting one track goes back to targeting the whole event. An omitted
// key would leave the old predicates in the column, still matching, while the editor showed
// an empty rule list, and the only symptom would be contacts landing in a portal whose
// filters read as empty on every screen that can display them.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { PortalFilters, PortalKind } from '@/types/portals'

export type PortalDraft = {
  eventId: RecordId
  name: string
  kind: PortalKind
  /** Enforced as exactly-one-per-event by the write path, never by the schema. */
  isDefault: boolean
  order: number
  filters: PortalFilters
  welcomeMessage?: string
  alwaysShowTasks: boolean
  manageProfile: boolean
}

/**
 * A new Portals row.
 *
 * `compact`, so an absent welcome message is simply not sent: there is no previous value to
 * leave in place on a create, and `null` into a column that has never held one is noise.
 *
 * The three booleans and `filterJson` are sent even when they are `false` and empty. On a
 * create that is indistinguishable from omitting them today, and it is written out anyway
 * because it makes the created row's shape identical to what `portalUpdateFields` maintains:
 * a create that quietly wrote fewer columns than every subsequent save is how the first save
 * after a create looks like a bigger change than it was.
 */
export function portalFields(draft: PortalDraft): FieldSet {
  return compact({
    [COL.name]: draft.name,
    [COL.event]: link(draft.eventId),
    [COL.kind]: draft.kind,
    [COL.isDefault]: draft.isDefault,
    [COL.order]: draft.order,
    [COL.filterJson]: JSON.stringify(draft.filters),
    [COL.welcomeMessage]: draft.welcomeMessage,
    [COL.alwaysShowTasks]: draft.alwaysShowTasks,
    [COL.manageProfile]: draft.manageProfile,
  })
}

export type PortalUpdate = Omit<PortalDraft, 'eventId'>

/**
 * An edit to an existing portal.
 *
 * The event link is NOT sent, for the reason `resourceEditFields` gives: a portal does not
 * change events, and re-sending the link on every save turns a mis-passed event id from a
 * failed write into a silent re-parenting, which here would move a whole portal's worth of
 * contacts to another conference.
 *
 * Every other column IS sent, including `null` for an emptied welcome message and including
 * `isDefault`. `isDefault` has to be here because moving the default is an edit to two rows
 * (the new default gains the box, the old one loses it) and the losing row's write is
 * nothing but this key; omitting it would leave an event with two defaults and no error.
 *
 * `filterJson` is always written; see the header.
 */
export function portalUpdateFields(update: PortalUpdate): FieldSet {
  return {
    [COL.name]: update.name,
    [COL.kind]: update.kind,
    [COL.isDefault]: update.isDefault,
    [COL.order]: update.order,
    [COL.filterJson]: JSON.stringify(update.filters),
    // `''` and `undefined` both mean the organizer left the editor empty, and neither may
    // leave last month's welcome text rendering above a speaker's task list. `compact` would
    // drop them, which is why this builder does not use it.
    [COL.welcomeMessage]: emptyToNull(update.welcomeMessage),
    [COL.alwaysShowTasks]: update.alwaysShowTasks,
    [COL.manageProfile]: update.manageProfile,
  }
}

/**
 * One row of a reorder: the new position and nothing else.
 *
 * Separate from `portalUpdateFields` rather than a call to it with the same values, because
 * a drag must not round-trip the filters. Sending them back would make the reorder a lost
 * update: an organizer editing a portal's rules in another tab has them reverted by somebody
 * else dragging a row, and the reverted rules are invisible from the list screen that did it.
 * This is the same failure `setResourcePublication` exists to avoid.
 */
export function portalOrderFields(order: number): FieldSet {
  return { [COL.order]: order }
}

/** `''` and `undefined` both become `null`, so the column is cleared rather than left. */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value
}
