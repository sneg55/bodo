// The nav's shape, and the two href builders. No data, so admin-nav.ts and
// admin-nav-sections.ts can both import it without a cycle.
//
// THERE IS NO TREE TYPE ANY MORE. `AdminNavTree`, `AdminNavSection`, `AdminNavLink` and
// `AdminNavEntry` all lived here until 2026-08-10, when the last collapsible in the sidebar
// (Program) was flattened into labelled blocks. What the tree bought was one level of
// disclosure over a hierarchy that was never real: Program declared `defaultOpen: true` and
// held fourteen of the nineteen destinations, so the chevron opened on first paint and hid
// nothing. A block with a section header renders the same rows with one less control, one
// less piece of client state, and no `kind` discriminant for every consumer to narrow on.

import type { LucideIcon } from 'lucide-react'

// THERE IS NO `placeholder` FLAG ANY MORE EITHER, and no page behind it. It marked a nav
// item with no requirement behind it, landing on a shared "not part of this build" card.
// Invoices, Site, Marketing, Reports, Studio and History were removed from the sidebar
// outright on 2026-08-09 (BUILD_SPEC 5.0b is amended accordingly), Portals became real with
// 5.0c, and CRM became real with R11, which left the flag set on nothing and the card
// reachable only by typing its URL. Flag, card, route and `adminPlaceholderHref` all went on
// 2026-08-10. Every leaf below now goes somewhere that is built, which is what the type
// should have said all along.

export type AdminNavLeaf = {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly href: string
}

/**
 * Blocks render in order, top to bottom, and they are the only grouping the sidebar has.
 *
 * A block with a `label` draws it as an uppercase section header with a trailing hairline,
 * which is the treatment the reference gives SUBMISSIONS and its siblings. A block without
 * one is separated from what precedes it by a plain rule; only the first block, holding
 * Dashboard on its own, is unlabelled today.
 */
export type AdminNavBlock = {
  readonly id: string
  readonly label?: string
  readonly items: readonly AdminNavLeaf[]
}

export function adminHref(eventId: string, path = ''): string {
  return `/admin/${eventId}${path}`
}
