// Active-item resolution for the admin sidebar. Separate from admin-nav.ts so the
// data and the traversal over it each stay well inside the file-size budget.
//
// `treeContainsNavId` used to live here, answering "should this collapsible be open?". It
// went with the last collapsible on 2026-08-10: every destination is on screen now, so
// there is nothing to open.

import type { AdminNavBlock, AdminNavLeaf } from '@/components/shell/admin-nav'

/** Every leaf, in render order. Used for active-item resolution. */
export function adminNavLeaves(blocks: readonly AdminNavBlock[]): readonly AdminNavLeaf[] {
  return blocks.flatMap((block) => block.items)
}

/**
 * Longest matching href wins. Two items legitimately sit under the same prefix
 * (Portals at /settings/portals, Settings at /settings), so a plain `startsWith`
 * would light both up; and Dashboard's href is a prefix of every other route, so
 * a plain match would light it up everywhere.
 */
export function resolveActiveNavId(
  blocks: readonly AdminNavBlock[],
  pathname: string,
): string | undefined {
  let bestId: string | undefined
  let bestLength = -1

  for (const leaf of adminNavLeaves(blocks)) {
    const matches = pathname === leaf.href || pathname.startsWith(`${leaf.href}/`)
    if (matches && leaf.href.length > bestLength) {
      bestId = leaf.id
      bestLength = leaf.href.length
    }
  }

  return bestId
}
