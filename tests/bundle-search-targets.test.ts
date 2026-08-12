// The palette's `Export` group: that every row lands somewhere real, and is findable.
//
// Two failure modes, and neither one announces itself in the UI. A row whose href has drifted
// away from the route it names still renders and still highlights; it just lands on a 404
// after the palette has already closed. And a row that no search term reaches is invisible,
// which is indistinguishable from the feature not existing, which is the exact finding this
// group was added to answer.

import { describe, expect, it } from 'vitest'

import { bundleSearchGroup } from '@/features/bundle/search-targets'
import { navSearchGroup } from '@/features/search/nav-targets'

const EVENT = 'rec-event-1'

const GROUP = bundleSearchGroup(EVENT)

/**
 * How `GlobalSearch` builds the string cmdk filters on.
 *
 * Reconstructed rather than imported, because that join happens inline in the component's
 * JSX. Kept beside a note in `search-targets.ts` so the two are found together: if the
 * component ever stops including the description, these assertions still pass and the rows go
 * quiet, so this is a mirror and not a proof.
 */
function searchValue(item: { label: string; description?: string }): string {
  return [GROUP.label, item.label, item.description ?? ''].join(' ').toLowerCase()
}

describe('every row lands on a route the sidebar agrees exists', () => {
  const navHrefs = new Set(navSearchGroup(EVENT).items.map((item) => item.href))

  it.each(GROUP.items.map((item) => [item.label, item.href] as const))(
    '%s goes to a built destination',
    (_label, href) => {
      // `navSearchGroup` is derived from `buildAdminNav` and excludes placeholders, so this
      // fails the moment one of these routes is renamed, removed or stubbed.
      expect(navHrefs.has(href)).toBe(true)
    },
  )

  it('scopes every destination to the event', () => {
    for (const item of GROUP.items) {
      expect(item.href.startsWith(`/admin/${EVENT}/`)).toBe(true)
    }
  })

  it('gives every row a distinct id and a distinct destination', () => {
    expect(new Set(GROUP.items.map((item) => item.id)).size).toBe(GROUP.items.length)
    expect(new Set(GROUP.items.map((item) => item.href)).size).toBe(GROUP.items.length)
  })
})

describe('the terms somebody would actually type', () => {
  // The recorded finding was "the command palette returns no export or download command".
  // These three are the words that search reaches for.
  it.each(['export', 'download', 'zip'])('every row is reachable by "%s"', (term) => {
    for (const item of GROUP.items) {
      expect(searchValue(item)).toContain(term)
    }
  })

  it('covers all four surfaces an export can be started from', () => {
    const hrefs = GROUP.items.map((item) => item.href)

    expect(hrefs).toContain(`/admin/${EVENT}/files`)
    expect(hrefs).toContain(`/admin/${EVENT}/portal-files`)
    expect(hrefs).toContain(`/admin/${EVENT}/file-requests`)
    expect(hrefs).toContain(`/admin/${EVENT}/abstracts`)
  })

  it('says what to do on arrival, because none of these rows exports anything itself', () => {
    for (const item of GROUP.items) {
      expect(item.description).toBeDefined()
      // Each description names the surface it lands on, so the row is not read as a button
      // that starts a download from the palette.
      expect(item.description?.includes(':')).toBe(true)
    }
  })
})
