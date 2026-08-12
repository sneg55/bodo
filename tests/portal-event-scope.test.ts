// The portal is scoped to the SPEAKER'S events, not to one configured event.
//
// The defect these pin was filed as major in the eval run of 2026-08-10: a proposal
// submitted through the public CFP never reached the submitter's portal. /portal and
// /portal/submissions listed only their older submissions, /portal/submissions/SESS-35
// answered a genuine 404 for a record that existed and was theirs, and the account menu
// offered no event switcher, all while the confirmation page told them to track it there.
//
// Everything below is the pure rule. The read it composes with (`listEventIdsForSpeaker`)
// is a single record fetch and is exercised through the surfaces, not here.

import { describe, expect, it } from 'vitest'

import { portalScopeOf } from '@/features/portal/event-scope'

const CONFIGURED = 'recPortalEvent'

describe('portalScopeOf', () => {
  it('returns every event the speaker is linked to', () => {
    expect(portalScopeOf(['recOne', 'recTwo'], CONFIGURED)).toEqual(['recOne', 'recTwo'])
  })

  it('does NOT add the configured event to a speaker who already has events', () => {
    // Adding it would put every speaker back in one shared conference, which is the whole
    // defect. A speaker in `recOther` must not be handed the portal event's submissions.
    expect(portalScopeOf(['recOther'], CONFIGURED)).not.toContain(CONFIGURED)
  })

  it('keeps the configured event for a speaker with none, so an invitee still has a portal', () => {
    // An invited speaker's record exists before their first submission and carries no event
    // links yet. An empty scope would leave the profile and task pages with no event to
    // resolve their own config against.
    expect(portalScopeOf([], CONFIGURED)).toEqual([CONFIGURED])
  })

  it('keeps the configured event when it is the only one they are in', () => {
    expect(portalScopeOf([CONFIGURED], CONFIGURED)).toEqual([CONFIGURED])
  })

  it('is never empty, so no caller has to handle a scope of nothing', () => {
    for (const linked of [[], ['recOne'], ['recOne', 'recTwo']]) {
      expect(portalScopeOf(linked, CONFIGURED).length).toBeGreaterThan(0)
    }
  })
})
