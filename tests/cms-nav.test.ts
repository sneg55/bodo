// The CMS sidebar entry: a flat link straight to Embeds.
//
// Pinned because it is a deliberate DEPARTURE from the reference, and an undocumented
// departure is indistinguishable from a regression. Ref 32's sidebar expands CMS to
// "Overview" and "Embeds", so anyone reading docs/parity/cms-embeds.md and matching the
// screenshot would restore the tree in good faith. bodo's CMS section holds exactly one
// surface, which made Overview a page whose entire content was a link to Embeds, behind a
// chevron that had to be opened to find it; it was removed on the owner's instruction
// 2026-08-10 and the deviation is recorded at the transcription it departs from.

import { describe, expect, it } from 'vitest'

import { type AdminNavLeaf, buildAdminNav } from '@/components/shell/admin-nav'
import { adminNavLeaves, resolveActiveNavId } from '@/components/shell/admin-nav-active'

const EVENT = 'recVZa0gqwt9VaNw3'

function cmsEntry(): AdminNavLeaf | undefined {
  return adminNavLeaves(buildAdminNav(EVENT)).find((leaf) => leaf.id === 'cms-embeds')
}

describe('the CMS nav entry', () => {
  it('reads "CMS Embeds", so a flat row still says which section it belongs to', () => {
    expect(cmsEntry()?.label).toBe('CMS Embeds')
  })

  it('sits under PROGRAM, beside the schedule the embed publishes', () => {
    const block = buildAdminNav(EVENT).find((candidate) =>
      candidate.items.some((item) => item.id === 'cms-embeds'),
    )

    expect(block?.label).toBe('PROGRAM')
  })

  it('goes to the embeds list itself rather than through a section page', () => {
    expect(cmsEntry()?.href).toBe(`/admin/${EVENT}/cms/embeds`)
  })

  it('offers no entry for the deleted CMS Overview route', () => {
    const ids = adminNavLeaves(buildAdminNav(EVENT)).map((leaf) => leaf.id)

    expect(ids).not.toContain('cms')
    expect(ids).not.toContain('cms-overview')
  })

  it('stays highlighted on an individual embed, which is a segment below it', () => {
    const nav = buildAdminNav(EVENT)
    expect(resolveActiveNavId(nav, `/admin/${EVENT}/cms/embeds`)).toBe('cms-embeds')
    expect(resolveActiveNavId(nav, `/admin/${EVENT}/cms/embeds/recEmbed1`)).toBe('cms-embeds')
  })
})
