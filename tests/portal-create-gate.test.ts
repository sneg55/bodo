// The create-portal wizard's gate. Pinned here because the rule it replaced was
// all-or-nothing on the name, so three of these assertions passed against a wizard that let
// an organizer skip Filters and Review entirely and ship a portal nobody lands on.

import { describe, expect, it } from 'vitest'

import { createPortalGate } from '@/features/portal-config/create-gate'
import type { PortalFilterRule } from '@/types/portals'

const TRACK: PortalFilterRule = { field: 'track', operator: 'is', values: ['recTrack1'] }
/** What `+ Add filter` inserts. Field and operator filled in, no value: matches nobody. */
const EMPTY_TRACK: PortalFilterRule = { field: 'track', operator: 'is', values: [] }

describe('createPortalGate', () => {
  it('blocks every step but the first while the name is empty', () => {
    const gate = createPortalGate({ name: '   ', rules: [] })

    expect(gate.completed.has('setup')).toBe(false)
    expect(gate.canSubmit).toBe(false)
    expect(gate.blockers).toEqual(['Give the portal a name.'])
  })

  it('opens the wizard once the portal has a name and no filters', () => {
    const gate = createPortalGate({ name: 'Workshop leads', rules: [] })

    expect(gate.completed.has('setup')).toBe(true)
    // No filters at all is a valid portal: every contact of the chosen types lands here.
    expect(gate.completed.has('filters')).toBe(true)
    expect(gate.blockers).toEqual([])
    expect(gate.canSubmit).toBe(true)
  })

  it('refuses to leave Filters while a rule carries no value', () => {
    const gate = createPortalGate({ name: 'Workshop leads', rules: [EMPTY_TRACK] })

    // `setup` stays complete, so the rail still lets them back to the name. It is the
    // FILTERS step that is incomplete, which is what locks Review and Content ahead of it.
    expect(gate.completed.has('setup')).toBe(true)
    expect(gate.completed.has('filters')).toBe(false)
    expect(gate.canSubmit).toBe(false)
    expect(gate.blockers).toEqual([
      'Every filter needs a value. A filter with none matches nobody.',
    ])
  })

  it('catches an empty rule sitting behind a valid one', () => {
    // The regression the old rule could not see at all: one good filter is not a licence
    // for the row underneath it, and this is the order they get added in.
    const gate = createPortalGate({ name: 'Workshop leads', rules: [TRACK, EMPTY_TRACK] })

    expect(gate.completed.has('filters')).toBe(false)
    expect(gate.canSubmit).toBe(false)
  })

  it('completes Filters when every rule carries a value', () => {
    const gate = createPortalGate({ name: 'Workshop leads', rules: [TRACK] })

    expect(gate.completed.has('filters')).toBe(true)
    expect(gate.canSubmit).toBe(true)
    expect(gate.blockers).toEqual([])
  })

  it('never gates Review, because an empty match warns rather than blocks', () => {
    // A session filter legitimately matches nobody before the CFP closes. Blocking there
    // would send an organizer away to widen a rule that was correct.
    const gate = createPortalGate({ name: 'Workshop leads', rules: [TRACK] })

    expect(gate.completed.has('review')).toBe(true)
    expect(gate.completed.has('content')).toBe(true)
  })

  it('reports the name first when both the name and a filter are unfinished', () => {
    // One sentence at a time, and it is the one from the step they are standing on first.
    const gate = createPortalGate({ name: '', rules: [EMPTY_TRACK] })

    expect(gate.blockers).toEqual(['Give the portal a name.'])
  })
})
