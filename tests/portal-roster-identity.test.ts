// The roster's ordering, and the display identity the chrome and the roster share.

import { describe, expect, it } from 'vitest'

import { displayNameOf, initialsOf, portalUserOf } from '@/features/portal/identity'
import { buildRoster, participantRoleLabel } from '@/features/portal/roster'

import { CO_SPEAKER, OWNER, participant, speaker, submission } from './helpers/portal-fakes'

describe('buildRoster', () => {
  it('puts the primary first even when a co-speaker sorts earlier', () => {
    // The DAL sorts on sortOrder alone, so without this the person the organizer talks to
    // renders below their co-speaker.
    const row = submission({}, [
      participant({ speakerId: CO_SPEAKER, role: 'co_speaker', isPrimary: false, sortOrder: 1 }),
      participant({ speakerId: OWNER, isPrimary: true, sortOrder: 2 }),
    ])

    expect(buildRoster(row, OWNER).map((entry) => entry.speakerId)).toEqual([OWNER, CO_SPEAKER])
  })

  it('orders non-primaries by sortOrder', () => {
    const row = submission({}, [
      participant({ speakerId: 'recC', isPrimary: false, sortOrder: 3 }),
      participant({ speakerId: 'recB', isPrimary: false, sortOrder: 2 }),
      participant({ speakerId: OWNER, isPrimary: true, sortOrder: 9 }),
    ])

    expect(buildRoster(row, OWNER).map((entry) => entry.speakerId)).toEqual([OWNER, 'recB', 'recC'])
  })

  it('marks the viewer and labels each role', () => {
    const row = submission({}, [
      participant({ speakerId: OWNER, isPrimary: true, sortOrder: 1 }),
      participant({ speakerId: CO_SPEAKER, role: 'co_speaker', isPrimary: false, sortOrder: 2 }),
    ])
    const roster = buildRoster(row, CO_SPEAKER)

    expect(roster.map((entry) => entry.isViewer)).toEqual([false, true])
    expect(roster.map((entry) => entry.roleLabel)).toEqual(['Speaker', 'Co-Speaker'])
  })

  it('does not leak the sort key into the view model', () => {
    const [entry] = buildRoster(submission(), OWNER)
    expect(entry).not.toHaveProperty('sortOrder')
  })

  it('carries each participant’s headshot so the roster shows the photo, not the initials', () => {
    const row = submission({}, [
      participant({
        speakerId: OWNER,
        speaker: speaker({ id: OWNER, headshotUrl: 'https://cdn.example.com/ada.jpg' }),
      }),
      participant({ speakerId: CO_SPEAKER, role: 'co_speaker', isPrimary: false, sortOrder: 2 }),
    ])

    expect(buildRoster(row, OWNER).map((entry) => entry.avatarUrl)).toEqual([
      'https://cdn.example.com/ada.jpg',
      undefined,
    ])
  })
})

describe('participantRoleLabel', () => {
  it('uses the product labels', () => {
    expect(participantRoleLabel('chairperson')).toBe('Chairperson')
  })
})

describe('identity', () => {
  it('takes two initials from the name', () => {
    expect(initialsOf('Sw', 'yx', 'swyx@ai.engineer')).toBe('SY')
  })

  it('falls back to the email when there is no name', () => {
    // A speaker created by a CFP submit that only captured an address. An empty avatar reads
    // as a broken image rather than as missing data.
    expect(initialsOf('', '', 'swyx@ai.engineer')).toBe('S')
  })

  it('uses one initial when only one name is set', () => {
    expect(initialsOf('Ada', '', 'ada@example.com')).toBe('A')
  })

  it('shows the email as the display name when there is no name', () => {
    expect(displayNameOf({ firstName: '', lastName: '', email: 'a@b.co' })).toBe('a@b.co')
  })

  it('builds the whole chrome user in one call', () => {
    expect(portalUserOf(speaker())).toEqual({
      name: 'Ada Okafor',
      email: 'owner@example.com',
      initials: 'AO',
      avatarUrl: undefined,
    })
  })

  it('carries the uploaded headshot, so the chrome shows it instead of the initials', () => {
    expect(
      portalUserOf(speaker({ headshotUrl: 'https://cdn.example.com/ada.jpg' })).avatarUrl,
    ).toBe('https://cdn.example.com/ada.jpg')
  })
})
