// The palette's "Go to" group, which is derived from the sidebar tree rather than listed.
//
// Split from `global-search.test.ts` because it shares no fixtures with the record search:
// this module reads `buildAdminNav` and needs no submissions, speakers or event data at all.
//
// The point of testing a derived list is to pin the derivation rules, not the contents. An
// assertion naming particular destinations would fail every time a route lands, which is
// exactly the change that should NOT break this.

import { describe, expect, it } from 'vitest'
import { navSearchGroup } from '@/features/search/nav-targets'

const EVENT = 'recEvent1'
const group = navSearchGroup(EVENT)

describe('navSearchGroup', () => {
  it('offers destinations with no query and no read at all', () => {
    // This is what makes the palette useful the instant it opens, before any request has
    // been made. The old palette could return nothing at any point, ever.
    expect(group.items.length).toBeGreaterThan(5)
  })

  // THE PLACEHOLDER-EXCLUSION TEST IS GONE, with the thing it excluded. It asserted that no
  // row's href hit `/placeholder/`, back when unbuilt nav entries landed on a shared "not
  // part of this build" card. That card, its route and the filter in `nav-targets.ts` were
  // deleted on 2026-08-10 once every sidebar entry resolved to a real surface. Kept as a note
  // rather than as a passing test, because a test whose subject no longer exists passes
  // vacuously forever and reads like live cover.

  it('scopes every destination to the event it was built for, bar the cross-event CRM', () => {
    // What this really guards is that a tree, which has no href at all, never becomes a
    // row: an `href: undefined` fails the prefix check rather than shipping a dead result.
    expect(group.items.every((item) => item.href.startsWith('/admin/'))).toBe(true)

    // The CRM is the deliberate exception, and it is the WHOLE exception: every one of its
    // surfaces spans each event the viewer holds a membership on, so none of them has an
    // event id to carry. Asserted as that rule rather than as a list of hrefs, because the
    // list grows with the CRM while the rule is what actually needs guarding: an unscoped
    // destination anywhere else should be a decision somebody makes here.
    const offEvent = group.items.filter((item) => !item.href.startsWith(`/admin/${EVENT}`))
    expect(offEvent.every((item) => item.href.startsWith('/admin/crm'))).toBe(true)
    expect(offEvent.map((item) => item.href)).toContain('/admin/crm')
    expect(offEvent.map((item) => item.href)).toContain('/admin/crm/dashboard')
  })

  it('prefixes a row with its block, so the two Forms stay distinguishable', () => {
    // `Forms` appears twice in the real product, once for submissions and once for portals.
    // The labels themselves tell them apart now (`Submission Forms` against `Portal Forms`);
    // the prefix is what says where in the product each one lands.
    const forms = group.items.filter((item) => item.label.endsWith('Forms'))

    expect(forms.length).toBeGreaterThan(1)
    expect(new Set(forms.map((item) => item.label)).size).toBe(forms.length)
  })

  it('has no two rows going to the same place', () => {
    const hrefs = group.items.map((item) => item.href)

    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('gives every row a label a person could have typed', () => {
    expect(group.items.every((item) => item.label.trim().length > 0)).toBe(true)
  })
})
