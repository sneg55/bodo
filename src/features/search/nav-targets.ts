// The palette's "Go to" group: every admin destination that is actually built.
//
// Derived from `buildAdminNav` rather than listed here, and that is the whole design. A
// hand-written list of destinations would be a second copy of the sidebar that drifts the
// first time a route lands, and the drift would be invisible: a palette missing a
// destination looks exactly like a palette working correctly.
//
// **THERE IS NO PLACEHOLDER FILTER ANY MORE**, because there is nothing to filter. This file
// used to drop any leaf whose href hit `/placeholder/`, on the grounds that somebody who
// types a name and presses Enter has asked to go somewhere, not to be told the feature does
// not exist. The rule outlived every entry that made it matter (Marketing, Reports, Studio,
// Invoices, Site and History left the sidebar on 2026-08-09; Portals became real with
// BUILD_SPEC 5.0c and CRM with R11) and then outlived the card itself, deleted 2026-08-10
// along with its route and `adminPlaceholderHref`. A filter matching nothing is worse than no
// filter: it reads as a live rule and it silently stops being one. Every leaf `buildAdminNav`
// returns now goes somewhere that is built, which is the invariant the sidebar owns.
//
// **Not every destination is event-scoped.** CRM is `/admin/crm` with no event id in it,
// because the speaker directory spans every event the viewer holds a membership on. It is a
// real destination and it belongs in the palette; what a row must carry is an href, not an
// event prefix.
//
// **Every row carries its BLOCK's label**, which is the section header the sidebar draws
// above it. It used to be needed to keep two rows called `Forms` apart, and the labels
// themselves now do that (`Submission Forms` against `Portal Forms`); the prefix stays
// because a palette row should say where in the product it lands, and because it is the
// only thing that distinguishes `Speakers` from `Speakers CRM` at a glance. Block labels
// are drawn uppercase in the sidebar and title-cased here, because `SPEAKER PORTAL > Tasks`
// in a list of search results reads as shouting rather than as a path.
//
// **The unlabelled block is not prefixed.** Only the first one, holding Dashboard, has no
// label; there is nothing to prefix it with and `Dashboard` needs no qualifying.
//
// This costs no read. It is why the palette answers something the moment it opens, even
// before the first debounced result arrives from `globalSearchAction`.

import { type AdminNavLeaf, buildAdminNav } from '@/components/shell/admin-nav'
import type { GlobalSearchGroup, GlobalSearchItem } from '@/types/search'

function itemFor(leaf: AdminNavLeaf, parentLabel?: string): GlobalSearchItem {
  return {
    id: `nav-${leaf.id}`,
    label: parentLabel === undefined ? leaf.label : `${parentLabel} > ${leaf.label}`,
    href: leaf.href,
  }
}

/** `COLLECT & REVIEW` to `Collect & Review`. The sidebar shouts; a result row should not. */
function titleCase(label: string): string {
  return label
    .toLowerCase()
    .split(' ')
    .map((word) => (word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ')
}

/**
 * Flattened in block order, which is the order the sidebar draws and therefore the order an
 * organizer's eye already knows. Deduplicated by href: two entries can resolve to one route
 * (Event Settings > Portals and the sidebar's own Portals row do), and two rows going to
 * one place reads as a bug.
 */
export function navSearchGroup(eventId: string): GlobalSearchGroup {
  const items = buildAdminNav(eventId).flatMap((block) =>
    block.items.map((leaf) =>
      itemFor(leaf, block.label === undefined ? undefined : titleCase(block.label)),
    ),
  )

  const seen = new Set<string>()
  return {
    id: 'go-to',
    label: 'Go to',
    items: items.filter((item) => {
      if (seen.has(item.href)) return false
      seen.add(item.href)
      return true
    }),
  }
}
