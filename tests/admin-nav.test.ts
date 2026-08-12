// The admin sidebar's shape: flat labelled blocks, no collapsible, no duplicate row.
//
// This file replaces `program-nav.test.ts`, which pinned the Program tree's four section
// headers and its `defaultOpen`. Every assertion here is a DEPARTURE from the reference,
// which is why they are pinned rather than left to a comment: docs/parity/abstracts-review.md
// transcribes "Program (collapsible) with Overview, SUBMISSIONS (...)", so anyone matching
// the screenshot would restore the chevron in good faith. Flattened on the owner's
// instruction 2026-08-10, the same call that flattened CRM and CMS earlier that day.

import { describe, expect, it } from 'vitest'

import { type AdminNavLeaf, buildAdminNav } from '@/components/shell/admin-nav'
import { adminNavLeaves, resolveActiveNavId } from '@/components/shell/admin-nav-active'

const EVENT = 'recVZa0gqwt9VaNw3'

const blocks = () => buildAdminNav(EVENT)
const leaves = (): readonly AdminNavLeaf[] => adminNavLeaves(blocks())

describe('the admin sidebar blocks', () => {
  it('draws the six blocks in order, with only Dashboard unlabelled', () => {
    expect(blocks().map((block) => block.label)).toEqual([
      undefined,
      'SUBMISSIONS',
      'PROGRAM',
      'SPEAKER PORTAL',
      'EVENT',
      'ORGANIZATION',
    ])
  })

  it('names no block after one of its own items', () => {
    // `PORTALS` contained `Portals`, so the header and one of its children were the same
    // word and the header stopped meaning anything.
    for (const block of blocks()) {
      const labels = block.items.map((item) => item.label.toUpperCase())
      expect(labels).not.toContain(block.label)
    }
  })

  it('puts every destination on screen, so nothing is behind a disclosure', () => {
    // The guard on the flattening itself. `AdminNavBlock` has no children-of-children slot
    // any more, so this is really an assertion that no future entry grows one back by
    // pointing at a launcher page instead.
    expect(leaves().length).toBeGreaterThan(15)
    expect(leaves().map((leaf) => leaf.href)).not.toContain(`/admin/${EVENT}/program`)
  })
})

describe('the duplicates the flattening removed', () => {
  it('offers Settings exactly once', () => {
    // There were two rows, both reading `Settings` and both `/admin/{id}/settings`: one at
    // the foot of the Program tree's CONFIGURE section, one in the bottom block.
    const settings = leaves().filter((leaf) => leaf.href === `/admin/${EVENT}/settings`)

    expect(settings).toHaveLength(1)
    expect(settings[0]?.id).toBe('settings')
  })

  it('gives every row a distinct label', () => {
    // `Forms` and `Files` each appeared twice, unqualified, going to different routes. What
    // told them apart was which section header you had scrolled past.
    const labels = leaves().map((leaf) => leaf.label)

    expect(new Set(labels).size).toBe(labels.length)
  })

  it('qualifies the portal surfaces rather than leaving them bare nouns', () => {
    const byId = new Map(leaves().map((leaf) => [leaf.id, leaf.label]))

    expect(byId.get('forms')).toBe('Submission Forms')
    expect(byId.get('portal-forms')).toBe('Portal Forms')
    expect(byId.get('portal-files')).toBe('Portal Files')
  })

  it('agrees with Event Settings about what /forms is called', () => {
    // `settingsNav` has said `Submission Forms` for the same route since it was written, so
    // the sidebar's bare `Forms` was the half that disagreed.
    const byId = new Map(leaves().map((leaf) => [leaf.id, leaf.href]))

    expect(byId.get('forms')).toBe(`/admin/${EVENT}/forms`)
  })

  it('has no two rows going to the same place', () => {
    const hrefs = leaves().map((leaf) => leaf.href)

    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})

describe('where the moved entries landed', () => {
  it('keeps Email history and Settings out of the programme blocks', () => {
    // They were under Program > CONFIGURE, which is a section about the event rather than
    // about the programme.
    const event = blocks().find((block) => block.label === 'EVENT')

    expect(event?.items.map((item) => item.id)).toEqual(['event-team', 'comms', 'settings'])
  })

  it('gives the cross-event CRM its own block, at the foot and named for its scope', () => {
    const labels = blocks().map((block) => block.label)
    const org = blocks().find((block) => block.label === 'ORGANIZATION')

    // Last, because everything above it is scoped by the event chip at the top of the
    // sidebar and this is not. A global block in the middle of that run would break it in
    // two for the reader.
    expect(labels.at(-1)).toBe('ORGANIZATION')
    // The three rows sit beside `crm` rather than under it: `crm` is a destination, not a
    // container, so a child under it would restore the chevron removed on 2026-08-10 over a
    // section whose first item is the page you are already on. Listing them in the nav at
    // all is also what puts them in the ⌘K palette, since nav-targets.ts derives from it.
    expect(org?.items.map((item) => item.id)).toEqual(['crm', 'crm-pipeline', 'crm-dashboard'])
  })

  it('scopes every block but ORGANIZATION to the event in the switcher', () => {
    // The invariant behind the split, and it is checkable rather than a matter of taste: a
    // row the event chip re-points carries the event id, and a row it does not must not.
    for (const block of blocks()) {
      for (const item of block.items) {
        if (block.label === 'ORGANIZATION') {
          expect(item.href).not.toContain(EVENT)
        } else {
          expect(item.href.startsWith(`/admin/${EVENT}`)).toBe(true)
        }
      }
    }
  })

  it('leaves PROGRAM meaning the schedule and its embed', () => {
    const program = blocks().find((block) => block.label === 'PROGRAM')

    expect(program?.items.map((item) => item.id)).toEqual(['agenda', 'cms-embeds'])
  })

  it('gives the CRM a different icon from the event roster it is confused with', () => {
    const byId = new Map(leaves().map((leaf) => [leaf.id, leaf.icon]))

    expect(byId.get('crm')).not.toBe(byId.get('speakers'))
  })
})

describe('active state after the move', () => {
  it('lights the one Settings row on a settings sub-route', () => {
    expect(resolveActiveNavId(blocks(), `/admin/${EVENT}/settings/details`)).toBe('settings')
  })

  it('lights Submission Forms on the form builder, not the portal forms row', () => {
    expect(resolveActiveNavId(blocks(), `/admin/${EVENT}/forms/recForm1`)).toBe('forms')
    expect(resolveActiveNavId(blocks(), `/admin/${EVENT}/portal-forms/recForm1`)).toBe(
      'portal-forms',
    )
  })

  it('does not light Dashboard from a route that merely starts with its href', () => {
    // Dashboard is `/admin/{id}`, a prefix of every event route, which is why resolution is
    // longest-match rather than a plain `startsWith`.
    expect(resolveActiveNavId(blocks(), `/admin/${EVENT}/tasks`)).toBe('tasks')
    expect(resolveActiveNavId(blocks(), `/admin/${EVENT}`)).toBe('dashboard')
  })
})
