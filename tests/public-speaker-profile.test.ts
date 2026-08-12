// The two rules behind the public speaker permalink that are expensive to debug through a browser:
// how a URL segment is derived from a person, and how their sessions are stamped with a day, a
// clock and a room.
//
// The slug is worth pinning because every failure mode is a 404 on a link somebody has already
// posted. There is no slug column, so the value is computed, and the inputs that break a naive
// computation are all real Speakers rows: two people with the same name (the reason a suffix
// exists at all), a name written with accents or in a script with no ASCII form, and a row with no
// name at all, which `mapSpeaker` can produce because it defaults both name columns to ''.
//
// The session shaping is worth pinning for one reason: Workers run `Date` and `Intl` in UTC. A
// session stamped in the wrong zone is not an obviously broken page, it is a page that tells a
// visitor to turn up five hours late, so the assertions below are on an event whose timezone is
// deliberately NOT UTC.

import { describe, expect, it, vi } from 'vitest'

// `public-profile.ts` also exports the DAL read, which reaches Airtable through `queries.ts`.
// Stubbed so importing the pure half costs no env, the same way `tests/speaker-initials.test.ts`
// stubs it to reach `roster-admin-view`.
vi.mock('@/services/airtable/queries', () => ({
  getEventBySlug: vi.fn(),
  listPublishedAgenda: vi.fn(),
  listRooms: vi.fn(),
}))

const {
  absoluteUrl,
  findPublicSpeaker,
  publicSpeakerRoster,
  publicSpeakerSessions,
  speakerMetaDescription,
  speakerSlug,
} = await import('@/features/speakers/public-profile')

const ADA = { id: 'recAda000000001', firstName: 'Ada', lastName: 'Okafor' }
/** The same NAME, a different record. The case the suffix exists for. */
const OTHER_ADA = { id: 'recAda000000002', firstName: 'Ada', lastName: 'Okafor' }

describe('speakerSlug', () => {
  it('is the folded name plus a six-character suffix, and never changes between calls', () => {
    expect(speakerSlug(ADA)).toMatch(/^ada-okafor-[a-z0-9]{6}$/u)
    expect(speakerSlug(ADA)).toBe(speakerSlug(ADA))
  })

  it('separates two speakers who share a name', () => {
    // Without the suffix these are one address and the second person is unreachable.
    expect(speakerSlug(ADA)).not.toBe(speakerSlug(OTHER_ADA))
    expect(speakerSlug(OTHER_ADA)).toMatch(/^ada-okafor-[a-z0-9]{6}$/u)
  })

  it('folds accents and drops punctuation rather than percent-encoding either', () => {
    expect(speakerSlug({ id: 'recJose', firstName: 'José', lastName: 'Álvarez-Núñez' })).toMatch(
      /^jose-alvarez-nunez-[a-z0-9]{6}$/u,
    )
    expect(speakerSlug({ id: 'recOn', firstName: "O'Neill", lastName: 'St. John' })).toMatch(
      /^o-neill-st-john-[a-z0-9]{6}$/u,
    )
  })

  it('falls back to `speaker` when the name contributes nothing', () => {
    // A script with no ASCII form, and a row whose name columns are blank or whitespace. Both
    // still resolve, because the suffix is what carries the identity.
    expect(speakerSlug({ id: 'recLi', firstName: '李', lastName: '雷' })).toMatch(
      /^speaker-[a-z0-9]{6}$/u,
    )
    expect(speakerSlug({ id: 'recBlank', firstName: '', lastName: '' })).toMatch(
      /^speaker-[a-z0-9]{6}$/u,
    )
    expect(speakerSlug({ id: 'recSpaces', firstName: '  ', lastName: ' ' })).toMatch(
      /^speaker-[a-z0-9]{6}$/u,
    )
    expect(speakerSlug({ id: 'recNone' })).toMatch(/^speaker-[a-z0-9]{6}$/u)

    // Two nameless speakers are still two addresses.
    expect(speakerSlug({ id: 'recBlank', firstName: '', lastName: '' })).not.toBe(
      speakerSlug({ id: 'recNone' }),
    )
  })

  it('is lowercase, bounded, and never ends the readable half on a separator', () => {
    const long = speakerSlug({ id: 'recLong', firstName: 'A'.repeat(80), lastName: 'B'.repeat(80) })
    expect(long).toMatch(/^[a-z0-9-]+$/u)
    // A truncation landing mid-name must not leave `--` where the suffix joins on.
    expect(long).not.toMatch(/--/u)
    expect(long.length).toBeLessThanOrEqual(60 + 1 + 6)
  })
})

describe('findPublicSpeaker', () => {
  const roster = [ADA, OTHER_ADA]

  it('resolves each same-named speaker to their own record', () => {
    expect(findPublicSpeaker(roster, speakerSlug(ADA))?.id).toBe(ADA.id)
    expect(findPublicSpeaker(roster, speakerSlug(OTHER_ADA))?.id).toBe(OTHER_ADA.id)
  })

  it('survives a URL that has been upper-cased or padded in transit', () => {
    expect(findPublicSpeaker(roster, ` ${speakerSlug(ADA).toUpperCase()} `)?.id).toBe(ADA.id)
  })

  it('answers undefined for a segment that names nobody', () => {
    expect(findPublicSpeaker(roster, 'ada-okafor')).toBeUndefined()
    expect(findPublicSpeaker(roster, '')).toBeUndefined()
    expect(findPublicSpeaker([], speakerSlug(ADA))).toBeUndefined()
  })
})

describe('publicSpeakerRoster', () => {
  it('lists a speaker once however many sessions they are on', () => {
    const rows = [
      { participants: [{ speaker: ADA }, { speaker: OTHER_ADA }] },
      { participants: [{ speaker: ADA }] },
    ]
    expect(publicSpeakerRoster(rows).map((speaker) => speaker.id)).toEqual([ADA.id, OTHER_ADA.id])
  })
})

describe('publicSpeakerSessions', () => {
  // 15:00Z is 11:00 in New York on 3 June, which is the whole point: read in UTC it would be 3pm.
  const rows = [
    {
      id: 'recSess1',
      title: 'Shipping on Fridays',
      startsAt: '2026-06-03T15:00:00.000Z',
      endsAt: '2026-06-03T16:00:00.000Z',
      roomId: 'recRoomA',
      participants: [{ speakerId: ADA.id }, { speakerId: OTHER_ADA.id }],
    },
    {
      id: 'recSess2',
      title: 'Somebody else entirely',
      startsAt: '2026-06-03T17:00:00.000Z',
      participants: [{ speakerId: OTHER_ADA.id }],
    },
    {
      id: 'recSess3',
      title: 'Not scheduled yet',
      participants: [{ speakerId: ADA.id }],
    },
  ]
  const context = {
    timeZone: 'America/New_York',
    roomName: (id: string) => (id === 'recRoomA' ? 'Hall A' : undefined),
  }

  it('keeps only the sessions this speaker is on, in the order they arrived', () => {
    expect(publicSpeakerSessions(rows, ADA.id, context).map((session) => session.id)).toEqual([
      'recSess1',
      'recSess3',
    ])
  })

  it('stamps the day, the clock range and the room in the EVENT timezone', () => {
    const [first] = publicSpeakerSessions(rows, ADA.id, context)
    expect(first).toEqual({
      id: 'recSess1',
      title: 'Shipping on Fridays',
      day: 'Wed, June 3, 2026',
      time: '11:00 AM - 12:00 PM',
      room: 'Hall A',
    })
  })

  it('omits what it does not have rather than printing a placeholder', () => {
    // An unscheduled session carries no day, no time and no room at all, so the page can leave the
    // line out instead of rendering `undefined` or an empty dash.
    const [, unscheduled] = publicSpeakerSessions(rows, ADA.id, context)
    expect(unscheduled).toEqual({ id: 'recSess3', title: 'Not scheduled yet' })

    // A start with no end shows the start alone, and a room id nothing resolves is dropped.
    const [openEnded] = publicSpeakerSessions(rows, OTHER_ADA.id, {
      ...context,
      roomName: () => undefined,
    })
    expect(openEnded.room).toBeUndefined()
    expect(publicSpeakerSessions(rows, OTHER_ADA.id, context)[1].time).toBe('1:00 PM')
  })

  it('drops the stamp rather than the session when the stored instant is junk', () => {
    // `Events.timezone` and the date columns are both reachable by hand in Airtable, and a session
    // that vanished off a speaker's page would be much harder to notice than one missing a time.
    const broken = [{ ...rows[0], id: 'recBad', startsAt: 'tomorrow', endsAt: 'tomorrow' }]
    expect(publicSpeakerSessions(broken, ADA.id, context)[0]).toEqual({
      id: 'recBad',
      title: 'Shipping on Fridays',
      room: 'Hall A',
    })
  })
})

describe('speakerMetaDescription', () => {
  const event = { name: 'Cascadia Systems 2026' }

  it('leads with the job title and the company, then says where they are speaking', () => {
    expect(
      speakerMetaDescription({
        speaker: { name: 'Ada Okafor', tagline: 'Principal Engineer', company: 'Latticework' },
        event,
        sessions: [1],
      }),
    ).toBe('Principal Engineer · Latticework. Speaking at Cascadia Systems 2026: 1 session.')
  })

  it('counts sessions in the plural and drops the role when there is none', () => {
    expect(speakerMetaDescription({ speaker: { name: 'Ada' }, event, sessions: [1, 2] })).toBe(
      'Speaking at Cascadia Systems 2026: 2 sessions.',
    )
    // The zero case is reachable between a speaker being published and their session being
    // rescheduled, and "0 sessions" in an unfurl reads as a broken page.
    expect(speakerMetaDescription({ speaker: { name: 'Ada' }, event, sessions: [] })).toBe(
      'Speaking at Cascadia Systems 2026.',
    )
  })
})

describe('absoluteUrl', () => {
  it('resolves a stored path against this deployment, since og:image cannot be relative', () => {
    expect(absoluteUrl('/api/files/abc', 'https://bodo.example')).toBe(
      'https://bodo.example/api/files/abc',
    )
    expect(absoluteUrl('https://cdn.example/a.png', 'https://bodo.example')).toBe(
      'https://cdn.example/a.png',
    )
  })

  it('refuses anything that is not http or https, and anything empty', () => {
    // `headshotUrl` is a plain text column, so these are typed values rather than attacks.
    expect(absoluteUrl('javascript:alert(1)', 'https://bodo.example')).toBeUndefined()
    expect(absoluteUrl('data:image/png;base64,AAAA', 'https://bodo.example')).toBeUndefined()
    expect(absoluteUrl('   ', 'https://bodo.example')).toBeUndefined()
  })
})
