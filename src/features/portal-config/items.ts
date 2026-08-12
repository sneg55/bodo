// Turning one portal editor save into the smallest set of PortalItems writes. BUILD_SPEC 5.0c.
//
// Pure, and separate from the action for the reason `match.ts` and `content.ts` are
// separate from their callers: this decides what a speaker can see, and the failure is
// invisible from the admin side where every portal looks the same.
//
// **The rule this file exists to keep.** PortalItems is an EXPOSURE GATE over the
// assignment, never a substitute for it. Nothing here produces a `TaskAssignment` or a
// `FileRequestAssignment`, nothing here deletes one, and nothing it emits may be read as
// evidence that one exists. Who owes what is `features/assignments/fanout.ts` at accept
// time; this only decides whether the surface is switched on and where it sits.
//
// **And the rule that decides how MUCH it writes.** §5.0c: "A row is written only when an
// organizer touches the control." That is not thrift, it is the absence asymmetry: a task,
// form or file request with no row is SHOWN, because every event in the base has assignments
// and zero PortalItems rows for those three kinds, so materialising a row per surface on
// first save would be a write with no user intent behind it and a permanent one. So a save
// that changes nothing emits nothing, and the diff below is what proves it.

import {
  isExposed,
  type PortalContent,
  type PortalContentRow,
} from '@/features/portal-config/content'
import type { PortalItemCreate, PortalItemPatch } from '@/services/airtable/mutations-portal-items'
import type { RecordId } from '@/types/domain'
import type { Portal } from '@/types/portals'
import { PORTAL_ITEM_TYPES, type PortalItem, type PortalItemType } from '@/types/resources'

/** One line of the editor as the client posts it back. */
export type PortalItemRow = {
  itemType: PortalItemType
  itemId: RecordId
  enabled: boolean
  order: number
}

export type PortalItemPlan = {
  creates: readonly PortalItemCreate[]
  patches: readonly PortalItemPatch[]
}

/**
 * A posted row naming something this event does not have.
 *
 * Its own result rather than a thrown error, because the caller turns it into a message an
 * organizer reads, and because "which row" is the only useful thing to say about it.
 */
export type PortalItemProblem = { itemType: PortalItemType; itemId: RecordId }

export type PortalItemPlanResult =
  | { ok: true; plan: PortalItemPlan }
  | { ok: false; unknown: readonly PortalItemProblem[] }

/**
 * The writes one save needs, diffed against what the base already holds.
 *
 * Takes the built `PortalContent` rather than the raw PortalItems rows, and that is the
 * load-bearing choice here: `buildPortalContent` has already resolved which rows belong to
 * THIS portal (including the pre-5.0c rows with no link, which belong to the default), which
 * duplicate row wins a repeated pair, that only `kind: 'task'` forms may sit on a portal, and
 * what absence means per kind. Re-deriving any of that here would be a second opinion about
 * exposure held one module away from the one the speaker portal reads.
 *
 * It also makes the event-scope check free. A posted `itemId` that is not in the content is
 * either a record from another conference or a CFP form, and both come back as `unknown`
 * rather than being written and then silently never rendered.
 */
export function planPortalItems(
  portal: Portal,
  content: PortalContent,
  rows: readonly PortalItemRow[],
): PortalItemPlanResult {
  const creates: PortalItemCreate[] = []
  const patches: PortalItemPatch[] = []
  const unknown: PortalItemProblem[] = []
  const known = contentIndex(content)

  for (const itemType of PORTAL_ITEM_TYPES) {
    const submitted = denseByKind(rows, itemType)
    const dragged = wasReordered(content, itemType, submitted)
    for (const [order, row] of submitted.entries()) {
      const current = known.get(`${itemType}:${row.itemId}`)
      if (current === undefined) {
        unknown.push({ itemType, itemId: row.itemId })
        continue
      }
      collect({ portal, current, enabled: row.enabled, order, dragged }, creates, patches)
    }
  }

  if (unknown.length > 0) return { ok: false, unknown }
  return { ok: true, plan: { creates, patches } }
}

/**
 * Whether this card's rows came back in a different sequence than they were rendered in.
 *
 * This is the second kind of "an organizer touched the control", and without it a drag on a
 * card whose rows have no PortalItems rows yet persisted NOTHING. Every task, form and file
 * request on a fresh event is in exactly that state, because absence means SHOWN for those
 * three kinds, so the most obvious thing an organizer does first (put the tasks in the order
 * a speaker should do them) silently reverted on the next read. Found in review.
 *
 * A sequence comparison rather than a per-row one, because there is no per-row signal to
 * compare against: `buildPortalContent` gives an untouched row a sentinel order, so "the
 * submitted order differs from the stored order" is true for every row on every save. What
 * is not true by default is that the ORDER OF THE CARD changed, and that only happens when
 * somebody dragged.
 *
 * Once it is true, every row in the kind gets a row written, including the ones that did not
 * move: an ordering is only meaningful as a total sequence, and persisting the two rows that
 * changed position while leaving the rest on a sentinel would put them in an order nobody
 * chose. That is a real write of real intent, so it does not violate the rule above; what
 * that rule forbids is materialising rows on a save that changed nothing.
 */
function wasReordered(
  content: PortalContent,
  itemType: PortalItemType,
  submitted: readonly PortalItemRow[],
): boolean {
  const rendered = renderedIds(content, itemType)
  // A subset or a superset is a client that posted something other than the whole card.
  // Treated as not a reorder: `denseByKind`'s own note explains that renumbering a subset
  // is a client bug this module cannot detect, and guessing here would write positions for
  // rows it was never given.
  if (rendered.length !== submitted.length) return false
  return submitted.some((row, index) => rendered.at(index) !== row.itemId)
}

/** The card's ids in the order the editor drew them. */
function renderedIds(content: PortalContent, itemType: PortalItemType): readonly RecordId[] {
  const ids: RecordId[] = []
  // Walked rather than indexed by `itemType`, for the reason `contentIndex` gives: no key
  // that came off a payload is ever used to index an object.
  for (const card of Object.values(content)) {
    for (const row of card) {
      if (row.itemType === itemType) ids.push(row.itemId)
    }
  }
  return ids
}

/**
 * `(kind, source record)` to the editor line, flattened out of the four cards.
 *
 * Keyed on the pair and not on the record id alone, exactly as `content.ts` keys its own
 * index, because PortalItems holds four kinds in one table: a posted row claiming to be a
 * task while naming a resource must come back as unknown rather than matching the page.
 *
 * Built by walking the cards rather than by indexing `content` per kind, so no key from the
 * payload is ever used to index an object. Each line already carries its own `itemType`
 * (`PortalContentRow`), so nothing is lost.
 */
function contentIndex(content: PortalContent): ReadonlyMap<string, PortalContentRow> {
  const index = new Map<string, PortalContentRow>()
  for (const card of Object.values(content)) {
    for (const row of card) index.set(`${row.itemType}:${row.itemId}`, row)
  }
  return index
}

/**
 * One row's contribution: a patch, a create, or nothing at all.
 *
 * The three cases, and each one is a decision rather than a fallthrough:
 *
 *   - **A row exists.** Patch it when `enabled` or `order` moved. `enabled` is the flag a
 *     speaker's access depends on and `order` is what the portal nav renders, so both are
 *     real changes; equality on both means the organizer opened the editor and saved it
 *     unchanged, which must not cost a write.
 *   - **No row, and the requested state is what absence already says.** Nothing. This is the
 *     case §5.0c is protecting: every task on every event is in it on the first save, and
 *     writing them would materialise a row per surface that nobody asked for and that can
 *     then only be removed by hand.
 *   - **No row, and the requested state differs.** Create one. The switch has been moved off
 *     the kind's default, which is exactly "an organizer touched the control".
 */
function collect(
  input: {
    portal: Portal
    current: PortalContentRow
    enabled: boolean
    order: number
    dragged: boolean
  },
  creates: PortalItemCreate[],
  patches: PortalItemPatch[],
): void {
  const { portal, current, enabled, order, dragged } = input
  const item = current.item

  if (item === undefined) {
    if (!dragged && enabled === isExposed(current.itemType, undefined)) return
    creates.push({ itemType: current.itemType, itemId: current.itemId, enabled, order })
    return
  }

  if (item.enabled === enabled && item.order === order) return
  patches.push({ id: item.id, enabled, order, portalId: backfill(portal, item) })
}

/**
 * The `portal` link for a row that predates portals being plural, and `undefined` otherwise.
 *
 * A row with no link is read as belonging to the event's DEFAULT portal (types/resources.ts),
 * which is correct but fragile: it is correct only for as long as nothing writes a second
 * portal's row without a link. Stamping the id while we are already patching the row costs
 * nothing and turns the convention into a fact.
 *
 * Only while already patching, deliberately. Backfilling an otherwise unchanged row would
 * make opening and saving a default portal rewrite every legacy row on the event, which is
 * the mass write the rest of this file exists to avoid.
 *
 * Never for a custom portal: `buildPortalContent` only hands a link-less row to the default
 * portal in the first place, so a custom portal seeing one would mean the index changed
 * underneath us, and stamping it would MOVE the row rather than record where it already was.
 */
function backfill(portal: Portal, item: PortalItem): RecordId | undefined {
  if (item.portalId !== undefined) return undefined
  return portal.isDefault ? portal.id : undefined
}

/**
 * The submitted rows for one kind, in the order the drag left them, renumbered from 0.
 *
 * Sorted on the posted `order` first and then renumbered, which is one step more than
 * `denseOrder` in content.ts does: that one takes the array order as intent because it runs
 * on the client's own array after a drop, while this runs on a payload that crossed the
 * wire, where array order is whatever the caller serialised. Sorting on the number the
 * client actually stated is the only reading that does not silently reorder a card because
 * a client built its JSON in a different sequence.
 *
 * Dense renumbering is why ties cannot survive a save, and on `Portals` a tie is a
 * correctness bug (`match.ts`). Here it is milder but the same shape: two rows sharing a
 * number make the portal's nav depend on the sequence Airtable happened to paginate them in,
 * so the order appears to change on its own between two reads with nothing written.
 *
 * Numbering runs over the SUBMITTED rows only. The editor posts a whole card, so that is the
 * whole kind; a caller posting a subset renumbers that subset from 0 and can collide with a
 * row it left out, which is a client bug this cannot detect and must not paper over by
 * inventing positions for rows it was not given.
 *
 * A REPEATED item id keeps its first position and the rest are dropped. Found in review: the
 * payload was taken at face value, so a client posting one task twice produced two creates in
 * one batch and a `(portal, item)` pair with two rows, which is precisely the duplicate state
 * `content.ts` has to resolve by record id on the way back out. It cannot be caught downstream
 * either, because both halves land in the same write. First position wins for the same reason
 * `pinnedPortalOrder` picks it for a repeated portal id: any other choice lets the last entry
 * in an array silently decide the order.
 */
function denseByKind(
  rows: readonly PortalItemRow[],
  itemType: PortalItemType,
): readonly PortalItemRow[] {
  const seen = new Set<RecordId>()
  return rows
    .filter((row) => row.itemType === itemType)
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      left.row.order !== right.row.order
        ? left.row.order - right.row.order
        : left.index - right.index,
    )
    .filter(({ row }) => {
      if (seen.has(row.itemId)) return false
      seen.add(row.itemId)
      return true
    })
    .map(({ row }) => row)
}
