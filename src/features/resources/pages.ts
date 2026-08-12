// Which resource pages a speaker may see, and in what order.
//
// Pure, and separate from the reads that feed it, because the visibility rule is the one
// part of R8 that is expensive to debug through the UI: getting it wrong shows an
// organizer's unfinished venue page to every speaker at the conference, and the failure
// is invisible from the admin side, where every page looks the same.
//
// The rule has two inputs and both are load-bearing:
//
//   1. The event. Every list here is filtered on `eventId` even though the DAL already
//      filters (`listByEvent` in reads.ts), because BOTH sides of the join carry an event
//      and only one of them is filtered by the read. A PortalItems row from another
//      conference must not be able to publish a page into this portal, which is the
//      second test below the obvious one.
//   2. The PortalItems row. A resource with no row, or a disabled row, is a DRAFT: the
//      organizer can edit it and no speaker can reach it. This is the only "not visible
//      to this speaker" state the schema can express, because `Resources.visibility`
//      offers only `portal` and `public`, and `public` is a superset of `portal` rather
//      than an alternative to it (types/resources.ts).
//
// Ordering is `order` then `title`, never insertion order. Airtable list order is not
// stable across pagination, so a list sorted on nothing reshuffles itself between reads
// and the portal's nav appears to move on its own.

import type { PortalItem, Resource } from '@/types/resources'

/** A resource with its publishing row, which is absent for a draft. */
export type ResourceEntry = {
  resource: Resource
  item?: PortalItem
}

/**
 * Every resource on the event, draft or published, for the admin list.
 *
 * Sorted on the resource's own `order`, which is the column the editor writes. The
 * portal sorts on the item's order instead; the editor writes the same number to both,
 * so the two lists agree unless somebody edits one of them in Airtable directly.
 */
export function adminResourceEntries(
  eventId: string,
  resources: readonly Resource[],
  items: readonly PortalItem[],
): readonly ResourceEntry[] {
  const byResource = resourceItemIndex(eventId, items)

  return resources
    .filter((resource) => resource.eventId === eventId)
    .map((resource) => ({ resource, item: byResource.get(resource.id) }))
    .sort((left, right) => compare(left.resource.order, right.resource.order, left, right))
}

/**
 * The pages one speaker may open, in portal order.
 *
 * Takes no speaker id, and that is not an omission: BUILD_SPEC 5.6 settles on one portal
 * per event and a resource page is event-scoped, so every speaker on the event sees the
 * same set. Per-speaker targeting would be a PortalItems-to-speaker link the schema does
 * not have, and inventing one here would be a rule nothing enforces on the write side.
 */
export function speakerResources(
  eventId: string,
  resources: readonly Resource[],
  items: readonly PortalItem[],
): readonly Resource[] {
  const byResource = resourceItemIndex(eventId, items)

  return resources
    .filter((resource) => resource.eventId === eventId)
    .flatMap((resource) => {
      const item = byResource.get(resource.id)
      if (item?.enabled !== true) return []
      return [{ resource, item }]
    })
    .sort((left, right) => compare(left.item.order, right.item.order, left, right))
    .map((entry) => entry.resource)
}

/** The page behind a URL segment, or `undefined` so the route can 404. */
export function findResourceBySlug(
  resources: readonly Resource[],
  slug: string,
): Resource | undefined {
  const wanted = slug.trim().toLowerCase()
  return resources.find((resource) => resource.slug.trim().toLowerCase() === wanted)
}

/**
 * Resource id to its publishing row, for one event.
 *
 * `itemType === 'resource'` is checked as well as the link, because PortalItems holds
 * four kinds in one table and only one of the four links is set per row: a task row that
 * somehow carried a resource link would otherwise publish a page nobody asked to publish.
 * The first row for a resource wins; a second one is a duplicate the editor never
 * creates, and picking deterministically beats picking whichever paginated first.
 */
function resourceItemIndex(
  eventId: string,
  items: readonly PortalItem[],
): ReadonlyMap<string, PortalItem> {
  const index = new Map<string, PortalItem>()
  for (const item of items) {
    if (item.eventId !== eventId) continue
    if (item.itemType !== 'resource') continue
    if (item.resourceId === undefined) continue
    if (!index.has(item.resourceId)) index.set(item.resourceId, item)
  }
  return index
}

/** Order, then title, then id, so the sort is total and therefore stable. */
function compare(
  leftOrder: number,
  rightOrder: number,
  left: ResourceEntry,
  right: ResourceEntry,
): number {
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  const byTitle = left.resource.title.localeCompare(right.resource.title)
  return byTitle === 0 ? left.resource.id.localeCompare(right.resource.id) : byTitle
}
