// What a portal exposes, and in what order. BUILD_SPEC 5.0c.
//
// Pure, for the same reason `features/resources/pages.ts` is: this decides what a speaker
// can see and the failure is invisible from the admin side, where every portal looks the
// same. It is also the file where §5.0c's one governing rule lives, so it is worth
// stating in full before any code:
//
//   PortalItems is an EXPOSURE GATE OVER THE ASSIGNMENT, never a substitute for it.
//
// There are already two mechanisms and this must not become a third. Assignment decides
// who owes what: `TaskAssignments` and `FileRequestAssignments`, fanned out per
// (task, speaker, submission) by `features/assignments/fanout.ts` at accept time.
// PortalItems decides what the portal exposes and in what order. So an enabled row shows
// a speaker only what they are actually assigned, and a disabled row hides the surface
// from every speaker regardless of assignment. Nothing here writes an assignment, and
// nothing here may be read as evidence that one exists: a row returned by this module
// means "the organizer left this surface switched on", not "somebody owes this".
//
// Every list is filtered on `eventId` even though the DAL already filters, because both
// sides of the join carry an event and only one of them is filtered by the read. A
// PortalItems row from another conference must not be able to publish a surface into this
// portal, which is the second test below the obvious one.

import type { RecordId, Task } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'
import type { Form } from '@/types/forms'
import type { Portal } from '@/types/portals'
import type { PortalItem, PortalItemType, Resource } from '@/types/resources'

/** One line in one of the editor's five cards. */
export type PortalContentRow = {
  itemType: PortalItemType
  /** The source record: the task, form, file request or resource this row is about. */
  itemId: RecordId
  title: string
  /**
   * The PortalItems row, absent when no organizer has ever touched this control. Absence
   * is meaningful and differs per kind, which is what `isExposed` encodes.
   */
  item?: PortalItem
  /** What the `Switch` renders. NOT `item?.enabled`: see `isExposed`. */
  enabled: boolean
  order: number
}

export type PortalContentSources = {
  tasks: readonly Task[]
  forms: readonly Form[]
  fileRequests: readonly FileRequest[]
  resources: readonly Resource[]
}

/** The editor's cards, in portal order within each kind. */
export type PortalContent = Record<PortalItemType, readonly PortalContentRow[]>

/**
 * Whether a surface is shown, given its PortalItems row or the absence of one.
 *
 * **The absence asymmetry is deliberate and load-bearing.** A row present answers for
 * itself, in both directions and for every kind. A row absent means:
 *
 *   - `resource`: DRAFT, i.e. hidden. A resource has no assignment behind it, so the row
 *     is the only visibility state the schema can express: `Resources.visibility` offers
 *     only `portal` and `public` and `public` is a superset of `portal` rather than an
 *     alternative to it (types/resources.ts). Unchanged from `resources/pages.ts`, which
 *     is the reading the portal already ships.
 *   - `task`, `form`, `file_request`: SHOWN.
 *
 * The second half is not a preference and reading it as one is how this ships broken:
 * every event in the base today has assignments and ZERO PortalItems rows for those three
 * kinds, so "no row means hidden" would empty every existing portal the moment this page
 * shipped, silently, with no write anywhere to point at. A row is written only when an
 * organizer touches the control, so absence has to keep meaning what it has always meant.
 */
export function isExposed(itemType: PortalItemType, item: PortalItem | undefined): boolean {
  if (item !== undefined) return item.enabled
  return itemType !== 'resource'
}

/**
 * Every surface the event has, per kind, with the portal's row attached where there is one.
 *
 * Takes the whole `Portal` rather than an id because the portal membership test needs
 * three of its fields at once (`id`, `eventId`, `isDefault`), and passing them separately
 * is how one call site ends up checking two of the three.
 *
 * Rows are returned for surfaces with no PortalItems row too: the editor's job is to show
 * an organizer every task on the event with a switch beside it, and a list that showed
 * only the touched ones would hide exactly the rows whose default nobody has confirmed.
 */
export function buildPortalContent(
  portal: Portal,
  sources: PortalContentSources,
  items: readonly PortalItem[],
): PortalContent {
  const index = itemIndex(portal, items)

  return {
    task: rowsFor('task', portal.eventId, index, sources.tasks),
    form: rowsFor('form', portal.eventId, index, portalForms(sources.forms)),
    file_request: rowsFor('file_request', portal.eventId, index, sources.fileRequests),
    resource: rowsFor('resource', portal.eventId, index, sources.resources),
  }
}

/**
 * Renumber from 0 so a drag cannot produce a tie.
 *
 * Takes the rows in the order the drag left them and does NOT re-sort: after a drop the
 * array order is the organizer's intent, and sorting on the stale `order` values first
 * would undo the drag it was called to record. Ties matter here for the same reason they
 * matter on `Portals` (`orderPortals` in match.ts): a shared number makes the answer
 * depend on the sequence Airtable happened to paginate the rows in, so the portal's nav
 * reshuffles itself between reads with nothing written.
 */
export function denseOrder(rows: readonly PortalContentRow[]): readonly PortalContentRow[] {
  return rows.map((row, index) => ({ ...row, order: index }))
}

/**
 * Only portal forms (`kind: 'task'`) can sit on a portal.
 *
 * A CFP form is answered at a public URL by strangers who are not yet a contact
 * (types/forms.ts), so exposing one as a portal surface would advertise a second route to
 * the same form to people who have already been through it, and the picker would list the
 * call for papers beside the speaker's onboarding questionnaire as if they were the same
 * kind of thing. The filter lives here rather than in the picker because the editor and
 * the speaker portal both read this module, and a rule enforced in one UI is a rule the
 * other one breaks.
 */
function portalForms(forms: readonly Form[]): readonly Form[] {
  return forms.filter((form) => form.kind === 'task')
}

/**
 * (kind, source record) to the portal's row.
 *
 * `itemType` is checked as well as the link, exactly as `resources/pages.ts` does, because
 * PortalItems holds four kinds in one table and only one of the four links is set per row:
 * a task row that somehow carried a resource link would otherwise publish a page nobody
 * asked to publish.
 *
 * A duplicate pair is resolved by the LOWEST RECORD ID, not by whichever came first in the
 * argument. The editor never writes a second row for a pair, but Airtable has no unique
 * index, so two rows disagreeing about `enabled` is a state the base can hold, and "first
 * in the list wins" would then make a surface visible or hidden according to the order
 * Airtable happened to paginate. Found by review: the earlier version claimed to pick
 * deterministically while actually inheriting the caller's ordering.
 *
 * The record id is the tie-break rather than `enabled`, because neither direction of
 * "enabled wins" is safe across kinds: the absence asymmetry above means a stray enabled
 * row would publish a draft page, and a stray disabled one would hide an assigned task.
 * An arbitrary but STABLE answer is what lets an organizer see the same thing twice and
 * fix it.
 */
function itemIndex(portal: Portal, items: readonly PortalItem[]): ReadonlyMap<string, PortalItem> {
  const index = new Map<string, PortalItem>()
  for (const item of items) {
    if (item.eventId !== portal.eventId) continue
    if (!belongsToPortal(portal, item)) continue
    const sourceId = sourceIdOf(item)
    if (sourceId === undefined) continue
    const key = `${item.itemType}:${sourceId}`
    const held = index.get(key)
    if (held === undefined || item.id < held.id) index.set(key, item)
  }
  return index
}

/**
 * A row with no `portalId` belongs to the event's DEFAULT portal.
 *
 * That is the documented migration state and not a guess: rows written before §5.0c added
 * multiple portals carry no link, and `savePortalItems` resolves them to the default
 * (types/resources.ts). Treating an absent link as "belongs to whichever portal is asking"
 * would be the other reading, and it would leak one portal's content into all of them the
 * moment a second portal existed, which is the same class of bug the `eventId` check above
 * exists to stop.
 */
function belongsToPortal(portal: Portal, item: PortalItem): boolean {
  if (item.portalId === undefined) return portal.isDefault
  return item.portalId === portal.id
}

function sourceIdOf(item: PortalItem): RecordId | undefined {
  const byType: Record<PortalItemType, RecordId | undefined> = {
    task: item.taskId,
    form: item.formId,
    file_request: item.fileRequestId,
    resource: item.resourceId,
  }
  return byType[item.itemType]
}

/** What every kind's source record has to offer this module, and nothing more. */
type SourceRecord = {
  id: RecordId
  eventId: RecordId
  /** `Task.title`, `Form.name`, `FileRequest.title`, `Resource.title`. */
  title?: string
  name?: string
  /** Only `Resource` carries one; see `orderOf`. */
  order?: number
}

function rowsFor(
  itemType: PortalItemType,
  eventId: RecordId,
  index: ReadonlyMap<string, PortalItem>,
  sources: readonly SourceRecord[],
): readonly PortalContentRow[] {
  return sources
    .filter((source) => source.eventId === eventId)
    .map((source) => {
      const item = index.get(`${itemType}:${source.id}`)
      return {
        itemType,
        itemId: source.id,
        title: source.title ?? source.name ?? '',
        item,
        enabled: isExposed(itemType, item),
        order: orderOf(source, item),
      }
    })
    .sort(compareRows)
}

/**
 * The row's own position when an organizer has given it one, otherwise the source
 * record's, otherwise last.
 *
 * Only `Resources` has an `order` column of its own, and it is the one the resource editor
 * writes, so falling back to it keeps the two admin lists agreeing (`resources/pages.ts`
 * sorts its admin view on exactly that). The other three kinds have no position until a
 * PortalItems row gives them one, and `MAX_SAFE_INTEGER` puts those after the ordered
 * rows, where `compareRows` then sorts them by title. Defaulting to 0 instead would let
 * every untouched task jump ahead of the rows an organizer deliberately dragged, so the
 * first save would appear to scramble the list.
 */
function orderOf(source: SourceRecord, item: PortalItem | undefined): number {
  return item?.order ?? source.order ?? Number.MAX_SAFE_INTEGER
}

/**
 * Order, then title, then id, so the sort is total and therefore stable.
 *
 * This is `resources/pages.ts`'s comparator applied to the other three kinds, on purpose
 * and as §5.0c asks: the portal already sorts items this way, and four comparators is how
 * two cards in the same editor come to disagree about what "first" means. Airtable list
 * order is not stable across pagination, so a list sorted on anything less than a total
 * order reshuffles itself between reads and the portal's nav appears to move on its own.
 */
function compareRows(left: PortalContentRow, right: PortalContentRow): number {
  if (left.order !== right.order) return left.order - right.order
  const byTitle = left.title.localeCompare(right.title)
  return byTitle === 0 ? left.itemId.localeCompare(right.itemId) : byTitle
}
