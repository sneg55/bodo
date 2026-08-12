// Which portal an ordered list hands a contact. The filter predicate itself is tested
// next door in tests/portal-filters.test.ts, which is where this file was split when it
// passed the size limit.

import { describe, expect, it } from 'vitest'

import { assignContacts, matchPortal } from '@/features/portal-config/match'
import type { Portal, PortalContact, PortalFilters } from '@/types/portals'

const EVENT = 'recEvent1'

function portal(over: Partial<Portal> & { id: string }): Portal {
  return {
    eventId: EVENT,
    name: over.id,
    kind: 'contacts',
    isDefault: false,
    order: 0,
    filters: { contactTypes: [], rules: [] },
    alwaysShowTasks: false,
    manageProfile: false,
    ...over,
  }
}

function contact(over: Partial<PortalContact> & { speakerId: string }): PortalContact {
  return { roles: ['speaker'], sessions: [], ...over }
}

function filters(over: Partial<PortalFilters>): PortalFilters {
  return { contactTypes: [], rules: [], ...over }
}

const DEFAULT_PORTAL = portal({ id: 'recDefault', isDefault: true, order: 9 })

describe('matchPortal', () => {
  it('returns the first portal in order that the contact qualifies for', () => {
    const speakers = portal({
      id: 'recSpeakers',
      order: 1,
      filters: filters({ contactTypes: ['speaker'] }),
    })
    const everyone = portal({ id: 'recEveryone', order: 2 })

    const matched = matchPortal([everyone, speakers, DEFAULT_PORTAL], contact({ speakerId: 'sp1' }))

    expect(matched?.id).toBe('recSpeakers')
  })

  it('considers portals by ascending order, not by the order they were passed in', () => {
    const later = portal({ id: 'recLater', order: 5 })
    const earlier = portal({ id: 'recEarlier', order: 2 })

    const matched = matchPortal([later, earlier, DEFAULT_PORTAL], contact({ speakerId: 'sp1' }))

    expect(matched?.id).toBe('recEarlier')
  })

  it('breaks an order tie on id, so the same input always gives the same answer', () => {
    const a = portal({ id: 'recAAA', order: 3 })
    const b = portal({ id: 'recBBB', order: 3 })

    expect(matchPortal([b, a, DEFAULT_PORTAL], contact({ speakerId: 'sp1' }))?.id).toBe('recAAA')
    expect(matchPortal([a, b, DEFAULT_PORTAL], contact({ speakerId: 'sp1' }))?.id).toBe('recAAA')
  })

  it('falls back to the default portal when nothing matches', () => {
    const moderators = portal({
      id: 'recModerators',
      order: 1,
      filters: filters({ contactTypes: ['moderator'] }),
    })

    const matched = matchPortal([moderators, DEFAULT_PORTAL], contact({ speakerId: 'sp1' }))

    expect(matched?.id).toBe('recDefault')
  })

  it('never matches the default portal early, even sitting at order 0 with filters on it', () => {
    const greedyDefault = portal({
      id: 'recDefault',
      isDefault: true,
      order: 0,
      filters: filters({ contactTypes: ['moderator'] }),
    })
    const speakers = portal({
      id: 'recSpeakers',
      order: 1,
      filters: filters({ contactTypes: ['speaker'] }),
    })

    const speaker = matchPortal([greedyDefault, speakers], contact({ speakerId: 'sp1' }))
    const moderator = matchPortal(
      [greedyDefault, speakers],
      contact({ speakerId: 'sp2', roles: ['moderator'] }),
    )

    // The custom portal wins for the speaker even though the default sorts first, and the
    // moderator still lands on the default despite its filters saying otherwise.
    expect(speaker?.id).toBe('recSpeakers')
    expect(moderator?.id).toBe('recDefault')
  })

  it('returns undefined when the event has no default portal, rather than inventing one', () => {
    const moderators = portal({
      id: 'recModerators',
      filters: filters({ contactTypes: ['moderator'] }),
    })

    expect(matchPortal([moderators], contact({ speakerId: 'sp1' }))).toBeUndefined()
  })

  it('falls back to the lowest-ordered default when an event illegally carries two', () => {
    // `savePortal` refuses to create this state, but the matcher reads what the base
    // holds rather than what the write path promised. An answer that depended on
    // Airtable's pagination order would make the resulting support question
    // unanswerable: two organizers looking at one event would see different portals for
    // the same speaker.
    const first = portal({ id: 'recDefaultB', isDefault: true, order: 1 })
    const second = portal({ id: 'recDefaultA', isDefault: true, order: 0 })
    const person = contact({ speakerId: 'sp1' })

    expect(matchPortal([first, second], person)?.id).toBe('recDefaultA')
    expect(matchPortal([second, first], person)?.id).toBe('recDefaultA')
  })
})

describe('assignContacts', () => {
  it('buckets every contact and leaves an empty bucket for a portal that matches nobody', () => {
    const speakers = portal({
      id: 'recSpeakers',
      order: 1,
      filters: filters({ contactTypes: ['speaker'] }),
    })
    const chairs = portal({
      id: 'recChairs',
      order: 2,
      filters: filters({ contactTypes: ['chairperson'] }),
    })

    const buckets = assignContacts(
      [chairs, speakers, DEFAULT_PORTAL],
      [
        contact({ speakerId: 'sp1' }),
        contact({ speakerId: 'sp2', roles: ['moderator'] }),
        contact({ speakerId: 'sp3' }),
      ],
    )

    expect(buckets.get('recSpeakers')?.map((row) => row.speakerId)).toEqual(['sp1', 'sp3'])
    expect(buckets.get('recChairs')).toEqual([])
    expect(buckets.get('recDefault')?.map((row) => row.speakerId)).toEqual(['sp2'])
  })

  it('agrees with matchPortal for every contact', () => {
    const portals = [
      portal({ id: 'recA', order: 1, filters: filters({ contactTypes: ['moderator'] }) }),
      portal({ id: 'recB', order: 2, filters: filters({ contactTypes: ['speaker'] }) }),
      DEFAULT_PORTAL,
    ]
    const contacts = [
      contact({ speakerId: 'sp1', roles: ['speaker', 'moderator'] }),
      contact({ speakerId: 'sp2', roles: [] }),
    ]

    const buckets = assignContacts(portals, contacts)

    for (const one of contacts) {
      const expected = matchPortal(portals, one)
      expect(buckets.get(expected?.id ?? '')).toContain(one)
    }
  })
})
