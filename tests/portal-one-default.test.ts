// The exactly-one-default invariant, which gates every write to the portal list.
//
// It had no test, and it decides whether a portal write happens at all: `savePortalAction`,
// the reorder and the delete all call it with the uncached list before touching anything.
//
// What is pinned here is mostly the MESSAGES, and that is the point rather than a shortcut.
// The failure is surfaced to the organizer verbatim through `portalActionFailure`, and the
// two directions are not the same kind of problem: zero is a gap the product can close by
// itself now, and two is a decision it must not make. Telling somebody to go and hand-edit
// the base for the repairable one is the defect this file exists to keep out.

import { describe, expect, it } from 'vitest'

import { requireOneDefault } from '@/features/portal-config/invariants'
import type { Portal } from '@/types/portals'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'

const EVENT = 'recEvent1'

function portal(overrides: Partial<Portal> & { id: string }): Portal {
  return {
    eventId: EVENT,
    name: `Portal ${overrides.id}`,
    kind: 'contacts',
    isDefault: false,
    order: 1,
    filters: EMPTY_PORTAL_FILTERS,
    alwaysShowTasks: false,
    manageProfile: false,
    ...overrides,
  }
}

const DEFAULT_PORTAL = portal({ id: 'recDefault', isDefault: true, order: 0 })

describe('requireOneDefault', () => {
  it('returns the default when there is exactly one', () => {
    const only = requireOneDefault(EVENT, [DEFAULT_PORTAL, portal({ id: 'recCustom' })])

    expect(only.id).toBe('recDefault')
  })

  it('returns the default even when it is not first in the list', () => {
    // The list arrives in assignment order, and nothing guarantees the default leads it.
    const only = requireOneDefault(EVENT, [portal({ id: 'recCustom' }), DEFAULT_PORTAL])

    expect(only.id).toBe('recDefault')
  })

  it('refuses an empty list', () => {
    expect(() => requireOneDefault(EVENT, [])).toThrow(/needs exactly one/u)
  })

  it('refuses a list of customs with no default', () => {
    expect(() => requireOneDefault(EVENT, [portal({ id: 'recCustom' })])).toThrow(
      /needs exactly one/u,
    )
  })

  it('sends the ZERO case to the Portals screen, never to Airtable', () => {
    // The repair lives in the product now (`repair-actions.ts`), so the message that used to
    // read "Fix it in Airtable" was instructing an organizer to go and do by hand exactly
    // what the button in front of them does. Anyone without base access was stuck.
    let message = ''
    try {
      requireOneDefault(EVENT, [])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('Portals screen')
    expect(message).not.toMatch(/airtable/iu)
  })

  it('refuses two defaults, and does not pretend it can pick one', () => {
    // Genuinely unrepairable here: nothing in the data says which default should survive,
    // and choosing would be this code silently reassigning whoever falls back to the loser.
    // So this one states the count and stops, which is honest rather than a dead end.
    let message = ''
    try {
      requireOneDefault(EVENT, [DEFAULT_PORTAL, portal({ id: 'recSecond', isDefault: true })])
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('2 default portals')
    expect(message).not.toMatch(/airtable/iu)
  })
})
