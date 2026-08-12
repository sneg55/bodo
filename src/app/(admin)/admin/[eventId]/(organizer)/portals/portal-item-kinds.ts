// The four kinds a portal exposes, as data, plus the two pure functions the cards and the
// save path share. BUILD_SPEC 5.0c.
//
// Split out of `PortalContentCard.tsx` because that file was over the 300-line budget with
// this table inside it, and because both the create wizard and the editor page need
// `portalItemWrites` without pulling the card's client bundle in behind it.
//
// FOUR KINDS, NOT FIVE. `PortalItems.itemType` is a four-value select, and PORTALS > Files
// is what a SPEAKER uploaded against a File Request rather than organizer-curated content,
// so a Files card would have had no row to write and would have put an organizer in charge
// of other people's uploads. BUILD_SPEC 5.0c records the correction.

import type { PortalContent, PortalContentRow } from '@/features/portal-config/content'
import type { PortalItemRow } from '@/features/portal-config/items'
import { PORTAL_ITEM_TYPES, type PortalItemType } from '@/types/resources'

/**
 * Per kind: the card heading, the noun one row is, where the record is created, and
 * whether an assigned-speakers count exists for it.
 *
 * Tasks and File Requests are the two assignable kinds. A form is answered THROUGH a task
 * and a page is assigned to nobody, so a count column on either would be a number with no
 * assignment behind it, which is exactly the confusion the exposure-gate rule guards.
 *
 * The order is portal order, which is the order §5.0c lists them in.
 */
export const PORTAL_ITEM_KINDS: readonly {
  itemType: PortalItemType
  title: string
  noun: string
  assignable: boolean
  /** The admin route that owns the record, relative to `/admin/{eventId}/`. */
  createPath: string
  /** The empty state's link text. It links to where the thing is made, not to a paragraph. */
  emptyBody: string
}[] = [
  {
    itemType: 'task',
    title: 'Tasks',
    noun: 'task',
    assignable: true,
    createPath: 'tasks',
    emptyBody: 'Create a task',
  },
  {
    itemType: 'form',
    title: 'Forms',
    noun: 'form',
    assignable: false,
    createPath: 'portal-forms',
    emptyBody: 'Create a portal form',
  },
  {
    itemType: 'file_request',
    title: 'File Requests',
    noun: 'file request',
    assignable: true,
    createPath: 'file-requests',
    emptyBody: 'Create a file request',
  },
  {
    itemType: 'resource',
    title: 'Pages',
    noun: 'page',
    assignable: false,
    createPath: 'resources',
    emptyBody: 'Create a resource page',
  },
]

export type PortalItemKind = (typeof PORTAL_ITEM_KINDS)[number]

/** The kind entry for a type. Total, because `PortalItemType` has exactly these four values. */
export function portalItemKind(itemType: PortalItemType): PortalItemKind {
  return PORTAL_ITEM_KINDS.find((kind) => kind.itemType === itemType) ?? PORTAL_ITEM_KINDS[0]
}

/** Where a row's source record is edited. Tasks and file requests have no per-record page. */
export function portalItemHref(itemType: PortalItemType, eventId: string, itemId: string): string {
  switch (itemType) {
    case 'task':
      return `/admin/${eventId}/tasks`
    case 'file_request':
      return `/admin/${eventId}/file-requests`
    case 'form':
      return `/admin/${eventId}/portal-forms/${itemId}`
    case 'resource':
      return `/admin/${eventId}/resources/${itemId}`
  }
}

/**
 * The card, as the editor currently reads, posted whole.
 *
 * **Every row of every kind, including untouched ones.** This used to filter to rows that
 * either had a `PortalItems` row already or whose switch had left the kind's default, which
 * dropped exactly the rows that make a REORDER legible and so lost drag-only changes
 * silently: absence means SHOWN for tasks, forms and file requests, so dragging those three
 * kinds moves no switch, every row was filtered out, and the save posted an empty list.
 * Found in review.
 *
 * The filtering has not moved, it has moved SERVER-SIDE, where it belongs. `planPortalItems`
 * still writes nothing for a row that matches the kind's absence default, so the absence
 * asymmetry is intact and opening this editor and saving it unchanged still costs zero
 * writes. What the server can now see, and could not before, is the whole sequence, which is
 * the only thing a reorder is visible in.
 *
 * `order` is the array index rather than `row.order`, because an untouched row carries the
 * sentinel order `buildPortalContent` gives it, and posting several of those would state a
 * sequence the screen is not showing.
 */
export function portalItemWrites(content: PortalContent): readonly PortalItemRow[] {
  return PORTAL_ITEM_TYPES.flatMap((itemType) =>
    portalContentRows(content, itemType).map((row, order) => ({
      itemType,
      itemId: row.itemId,
      enabled: row.enabled,
      order,
    })),
  )
}

/**
 * One kind's rows, read through a switch rather than `content[itemType]`.
 *
 * Not style: `security/detect-object-injection` is an error here, and it is right to be,
 * because a computed read off a caller-supplied key is how a typo returns `undefined` and
 * the card silently renders empty instead of failing. Four explicit cases cannot.
 */
export function portalContentRows(
  content: PortalContent,
  itemType: PortalItemType,
): readonly PortalContentRow[] {
  switch (itemType) {
    case 'task':
      return content.task
    case 'form':
      return content.form
    case 'file_request':
      return content.file_request
    case 'resource':
      return content.resource
  }
}

/** The same content with one kind's rows replaced. The write half of `portalContentRows`. */
export function withPortalContentRows(
  content: PortalContent,
  itemType: PortalItemType,
  rows: readonly PortalContentRow[],
): PortalContent {
  switch (itemType) {
    case 'task':
      return { ...content, task: rows }
    case 'form':
      return { ...content, form: rows }
    case 'file_request':
      return { ...content, file_request: rows }
    case 'resource':
      return { ...content, resource: rows }
  }
}
