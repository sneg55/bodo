// The avatar fallback, and the one input that used to produce nothing.
//
// A grader recorded that two speaker cards "render a blank circle with no initials at all".
// The seeded rows behind that particular screenshot turned out to be a data problem (a flat
// blue 256x256 PNG uploaded as a headshot, which is an image and not a fallback), but the
// walk through every initials helper it prompted found a real one: three of the four ended
// at `email.charAt(0)`, which is `''` for a Speakers row whose name and email columns are
// all blank or whitespace, and `AvatarFallback` handed `''` draws an empty circle.
//
// `mapSpeaker` defaults both name columns to `''`, so that row is reachable rather than
// hypothetical. These are the cases worth pinning, because none of them is visible in the
// happy path and all of them render as "the avatar is broken".

import { describe, expect, it, vi } from 'vitest'

import { speakerInitials } from '@/features/speakers/initials'

import { participant, submission } from './helpers/portal-fakes'

// `roster-admin-view.ts` also exports the candidate reader, which reaches the Airtable
// client through `queries.ts`. Stubbed so importing the pure half costs no env.
vi.mock('@/services/airtable/queries', () => ({ listSpeakers: vi.fn() }))

const { adminRosterRows } = await import('@/features/submissions/roster-admin-view')

describe('speakerInitials', () => {
  it('takes the two name initials when both are there', () => {
    expect(
      speakerInitials({ firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com' }),
    ).toBe('AO')
  })

  it('uses the email ONLY when there is no name initial at all', () => {
    // The email is a fallback, not a filler. Concatenating all three sources made a person
    // with one name half borrow a letter from their address: `Marchetti` plus `e@x.com` read
    // `ME`, and Ada with no surname read `AA`. Both print a letter the person does not have.
    // One initial is the honest answer, and it is what the portal's own rule always gave.
    expect(speakerInitials({ firstName: '', lastName: 'Marchetti', email: 'e@x.com' })).toBe('M')
    expect(speakerInitials({ firstName: 'Ada', lastName: '', email: 'ada@example.com' })).toBe('A')

    // With NO name at all the address is all there is, and one letter beats an empty circle.
    expect(speakerInitials({ firstName: '', lastName: '', email: 'zed@example.com' })).toBe('Z')
  })

  it('answers ? rather than an empty string when there is nothing at all', () => {
    // The blank-circle case. Every one of these is a row `mapSpeaker` can produce.
    expect(speakerInitials({ firstName: '', lastName: '', email: '' })).toBe('?')
    expect(speakerInitials({ firstName: '   ', lastName: ' ', email: '  ' })).toBe('?')
    expect(speakerInitials({})).toBe('?')
  })
})

describe('adminRosterRows', () => {
  const cast = [
    participant({
      id: 'recPar2',
      speakerId: 'recSpeakerCo',
      isPrimary: false,
      role: 'co_speaker',
      sortOrder: 1,
      speaker: {
        id: 'recSpeakerCo',
        email: 'marcus@example.com',
        firstName: 'Marcus',
        lastName: 'Okafor',
        links: {},
      },
    }),
    participant({
      id: 'recPar1',
      speakerId: 'recSpeakerOwner',
      isPrimary: true,
      role: 'speaker',
      sortOrder: 9,
      // A row with nothing on it, which is what the shared helper exists for.
      speaker: { id: 'recSpeakerOwner', email: '', firstName: '', lastName: '', links: {} },
    }),
  ]

  it('puts the primary first however the sort order runs', () => {
    // `sortOrder` alone would render the co-speaker above the submitter. The organizer talks
    // to the primary, so the primary leads.
    expect(adminRosterRows(submission({}, cast)).map((row) => row.id)).toEqual([
      'recPar1',
      'recPar2',
    ])
  })

  it('never hands the avatar an empty fallback', () => {
    expect(adminRosterRows(submission({}, cast)).map((row) => row.initials)).toEqual(['?', 'MO'])
  })
})
