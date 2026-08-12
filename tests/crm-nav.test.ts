// The CRM's sidebar entry: one flat row, `Speakers CRM`, going straight to the directory.
//
// It was a collapsible tree twice over (a chevron above a single `Speakers` child, then that
// child plus a LISTS section) and was flattened on 2026-08-10. These assertions pin the
// flatness rather than only the destination, because the failure this replaces was not a
// broken link: every href worked, and the row was still a chevron you had to open to reach
// the page it was named after.

import { describe, expect, it } from 'vitest'

import { buildAdminNav } from '@/components/shell/admin-nav'
import { adminNavLeaves, resolveActiveNavId } from '@/components/shell/admin-nav-active'

const entries = () => adminNavLeaves(buildAdminNav('evt1'))
const crmLink = () => {
  const entry = entries().find((leaf) => leaf.id === 'crm')
  if (entry === undefined) throw new Error('the CRM entry is missing from the sidebar')
  return entry
}

describe('the CRM entry in the admin sidebar', () => {
  it('goes straight to the directory', () => {
    expect(crmLink().href).toBe('/admin/crm')
  })

  it('reads Speakers CRM, because the row is the destination and not a section header', () => {
    expect(crmLink().label).toBe('Speakers CRM')
  })

  it('carries no event id, because the directory is cross-event', () => {
    // Every other entry in the nav is `/admin/evt1/...`. This one authorizes on the viewer's
    // membership set instead, so an event id in the href would be a lie.
    expect(crmLink().href).not.toContain('evt1')
  })

  it('appears exactly once, so nothing else claims the id', () => {
    expect(entries().filter((leaf) => leaf.id === 'crm')).toHaveLength(1)
  })

  it('leaves no orphaned child ids behind anywhere in the nav', () => {
    // `crm-speakers` was the tree's lead item and `crm-lists` its section. Either surviving
    // would mean a half-applied flattening: a link that renders plus a child that cannot.
    const ids = entries().map((leaf) => leaf.id)

    expect(ids).not.toContain('crm-speakers')
    expect(ids).not.toContain('crm-lists')
  })
})

describe('active state on the CRM routes', () => {
  it('lights up on the directory itself', () => {
    expect(resolveActiveNavId(buildAdminNav('evt1'), '/admin/crm')).toBe('crm')
  })

  it('stays lit on a speaker profile, which is a child route of the directory', () => {
    expect(resolveActiveNavId(buildAdminNav('evt1'), '/admin/crm/recSpk1')).toBe('crm')
  })

  it('stays lit on the import wizard', () => {
    expect(resolveActiveNavId(buildAdminNav('evt1'), '/admin/crm/import')).toBe('crm')
  })

  it('does not light up from an event route that merely starts the same way', () => {
    // `/admin/crm` is not a prefix of `/admin/evt1/...`, but Dashboard's `/admin/evt1` IS a
    // prefix of most of them, which is why resolution is longest-match. Pinned so a future
    // change to that rule cannot quietly light two rows at once.
    expect(resolveActiveNavId(buildAdminNav('evt1'), '/admin/evt1/speakers')).not.toBe('crm')
  })
})
