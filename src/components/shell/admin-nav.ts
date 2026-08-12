// The admin sidebar's nav, as data.
//
// Kept out of AdminSidebar.tsx for two reasons. It is the one place the grouping and labels
// from BUILD_SPEC 5.0b live, so a familiarity regression is a one-file diff rather than a
// hunt through JSX. And it has no client dependencies, so a server component (a breadcrumb,
// the ⌘K palette's "Go to" group) can read the same data without pulling the sidebar's
// client bundle in with it.
//
// The blocks themselves are in admin-nav-sections.ts and the shape they satisfy is in
// admin-nav-types.ts, which this file re-exports so no consumer imports three paths. Three
// files rather than one because this one was already past the file-size budget with the nav
// inlined in it.
//
// NOTHING IS COLLAPSIBLE. `Forms` and `Files` used to appear twice each, once under
// SUBMISSIONS or COLLECT & REVIEW and once under PORTALS; they are `Submission Forms`,
// `Portal Forms` and `Portal Files` now. The reasoning for the flattening and for each
// rename is at the top of admin-nav-sections.ts, beside the entries it changed.

import { StarIcon } from 'lucide-react'

import { eventNavBlocks } from '@/components/shell/admin-nav-sections'

import { type AdminNavBlock, adminHref } from '@/components/shell/admin-nav-types'

export {
  type AdminNavBlock,
  type AdminNavLeaf,
  adminHref,
} from '@/components/shell/admin-nav-types'

/**
 * What a `reviewer` membership sees: their queue, and nothing else.
 *
 * A reviewer used to get the organizer's whole nav, because the layout admitted any
 * membership and the nav never asked which one was held. Every entry on it either
 * refused them or, worse, did not: the abstracts list rendered in full. The routes are
 * gated for real by `(organizer)/layout.tsx`; this is the other half of the same fix,
 * so a reviewer is not offered eighteen doors that are shut.
 *
 * Evaluation only, deliberately. Settings, Event Team and Preview are all organizer
 * surfaces, and an entry that renders a refusal is worse than no entry. The label and
 * the icon are the same ones the organizer's own SUBMISSIONS block uses, so the two
 * navs do not disagree about what the surface is called.
 */
export function buildReviewerNav(eventId: string): readonly AdminNavBlock[] {
  return [
    {
      id: 'primary',
      items: [
        {
          id: 'evaluation',
          label: 'Evaluation',
          icon: StarIcon,
          href: adminHref(eventId, '/evaluation'),
        },
      ],
    },
  ]
}

/**
 * NO OPTIONS ANY MORE, and both entries that needed one are gone for related reasons.
 *
 * `Preview` was the first: what it previewed was the event's published CFP form and only the
 * caller could resolve that. It was removed on the owner's instruction (2026-08-09) and the
 * shape of it argues the same way: with no published form there was nothing to preview, so
 * it fell back to the out-of-scope card, and it did that WITHOUT carrying the `placeholder`
 * flag, so the ⌘K nav derivation had to work around it by inspecting the href instead. A
 * sidebar row that is sometimes a real link and sometimes an apology is worse than either.
 * Both the flag and that workaround are gone with the card (2026-08-10). The capability is
 * not lost: the published form's own row on the dashboard links to it (`PanelForms`), which
 * is where an organizer is when they want to look at it.
 *
 * `speakerLists` was the second, and it was removed on the owner's instruction (2026-08-10)
 * when CRM became a flat link. It is worth recording what it cost rather than only that it
 * went: the sidebar renders on EVERY admin page, so a saved-lists section under CRM meant
 * `listSpeakerLists` plus a membership read on every one of them, to draw rows that most
 * organizers had none of. That read is gone with the section.
 *
 * So this is a pure function of one string, which is what it should have been: the ⌘K
 * palette's nav targets and the sidebar cannot disagree about what the nav contains.
 */
export function buildAdminNav(eventId: string): readonly AdminNavBlock[] {
  return eventNavBlocks(eventId)
}
