// The palette's `Export` group: where an organizer goes to start a bundle download.
//
// It exists because searching the palette for `export` or `download` returned nothing at all,
// which read as "this product cannot do that" on the one control an organizer reaches for
// when they cannot find a feature.
//
// **These NAVIGATE, they do not export.** Every one of the four surfaces exports the CHECKED
// SELECTION (docs/parity/external-references.md, "Bulk file download"), and a palette entry
// cannot know what is ticked on a page the organizer may not even be looking at. A command
// that started an export from nowhere would have to invent a scope, and the only scopes
// available to invent are "everything" and "nothing": one is a hundred-megabyte surprise, the
// other is an error message. So each row goes to the surface and its description says what to
// do on arrival. That is also the palette's only existing interaction model: `ResultItem`
// takes an href and `GlobalSearch` calls `router.push` on it, and this group is rendered by
// the same component as `Go to`.
//
// **Every href is asserted against `buildAdminNav`** in tests/bundle-search-targets.test.ts,
// which is the anti-drift check that matters: if one of these routes moves, the sidebar moves
// with it and a hardcoded href here would quietly point at a 404. A palette row that lands
// nowhere is worse than no row.
//
// **The descriptions carry the words people search for.** `GlobalSearch` matches on
// `[group label, label, description].join(' ')` and cmdk filters on that string, so `export`,
// `download` and `ZIP` each have to appear in a row's own text or the row is unfindable by
// the term that would send somebody looking for it. They read as instructions rather than as
// keyword stuffing, which is the constraint that kept them short.

import type { GlobalSearchGroup } from '@/types/search'

export function bundleSearchGroup(eventId: string): GlobalSearchGroup {
  const admin = `/admin/${eventId}`

  return {
    id: 'export',
    label: 'Export',
    items: [
      {
        id: 'export-submission-files',
        label: 'Export session files',
        description: 'Program > Files: tick rows, then download a ZIP',
        href: `${admin}/files`,
      },
      {
        id: 'export-portal-files',
        label: 'Export portal files',
        description: 'Portals > Files: tick rows, then download a ZIP',
        href: `${admin}/portal-files`,
      },
      {
        id: 'export-file-requests',
        label: 'Export delivered file requests',
        description: 'File Requests: tick requests, then download a ZIP',
        href: `${admin}/file-requests`,
      },
      {
        id: 'export-abstract-files',
        // The abstracts modal's own label, verbatim off ref 22, because somebody who has seen
        // that menu item will search for the words it used. It is the one entry here whose
        // surface delivers by email rather than streaming, and the description says so.
        label: 'Download files bundle',
        description: 'Abstracts: tick rows, then Options. ZIP by email',
        href: `${admin}/abstracts`,
      },
    ],
  }
}
