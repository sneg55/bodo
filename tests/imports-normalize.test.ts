// Mapping each source onto bodo's shapes.
//
// The first describe block is the one that matters most: no code path may produce an
// email address the source did not supply. A synthesised `first.last@example.com` passes
// every validation in this codebase and sends a magic link to a stranger.

import { describe, expect, it } from 'vitest'

import {
  normalizeAccelevents,
  normalizeSessionboard,
  normalizeSessionize,
  previewCounts,
  toNeedsEmailRows,
} from '@/features/imports/normalize'
import { parseSessionizeAll } from '@/services/imports/sessionize'
import type { ImportMapping } from '@/types/imports'

const SESSIONIZE_RAW = {
  sessions: [
    {
      id: '14022',
      title: 'Shipping on Workers',
      startsAt: '2026-09-01T09:00:00Z',
      isServiceSession: false,
      // Deliberately empty: the only link to Ada is the integer on her own record.
      speakers: [],
      categoryItems: [101, 201, 301, 401],
      roomId: 7,
      status: 'Accepted',
    },
    { id: '14099', title: 'Lunch', isServiceSession: true, speakers: [], status: null, roomId: 7 },
  ],
  speakers: [
    {
      id: 'ada-guid',
      firstName: 'Ada',
      lastName: 'Okafor',
      fullName: 'Ada Okafor',
      bio: 'Builds things.',
      tagLine: 'Staff Engineer',
      links: [{ title: 'LinkedIn', url: 'https://linkedin.com/in/ada', linkType: 'LinkedIn' }],
      sessions: [14022],
    },
  ],
  rooms: [{ id: 7, name: 'Main Hall', sort: 1 }],
  categories: [
    { id: 1, title: 'Track', type: 'session', items: [{ id: 101, name: 'Platform' }] },
    { id: 2, title: 'Level', type: 'session', items: [{ id: 201, name: 'Advanced' }] },
    { id: 3, title: 'Session format', type: 'session', items: [{ id: 301, name: 'Workshop' }] },
    { id: 4, title: 'Sponsor tier', type: 'session', items: [{ id: 401, name: 'Gold' }] },
  ],
  questions: [],
}

const MAPPING: ImportMapping = {
  categories: { '1': 'track', '2': 'level', '3': 'format' },
}

const sessionize = () => parseSessionizeAll(JSON.stringify(SESSIONIZE_RAW), 'demo')

describe('no address is ever invented', () => {
  it('leaves every Sessionize speaker empty and owes the organizer the list', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)

    expect(result.speakers.map((s) => s.email)).toEqual([''])
    expect(JSON.stringify(result)).not.toContain('@')
    expect(result.needsEmail).toEqual([{ name: 'Ada Okafor', remoteId: 'ada-guid' }])
  })

  it('drops nobody: the speaker is still created, just uncontactable', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)

    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0].firstName).toBe('Ada')
    expect(result.speakers[0].links.linkedin).toBe('https://linkedin.com/in/ada')
  })

  it('reports a Sessionboard contact with no address the same way', () => {
    const result = normalizeSessionboard({
      sessions: [],
      contacts: [
        { id: 'c1', email: 'ada@example.com', first_name: 'Ada', last_name: 'Okafor' },
        { id: 'c2', email: '  ', full_name: 'Bo Lin' },
      ],
    })

    expect(result.speakers[0].email).toBe('ada@example.com')
    expect(result.speakers[1].email).toBe('')
    expect(result.needsEmail).toEqual([{ name: 'Bo Lin', remoteId: 'c2' }])
  })
})

describe('normalizeSessionize', () => {
  it('joins the integer reverse link onto the string session id (trap 1)', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)
    const talk = result.submissions[0]

    // The session lists no speakers; only `speaker.sessions: [14022]` connects them.
    // Without the boundary coercion this array is empty and nobody notices.
    expect(talk.participants).toEqual([
      { speakerRemoteId: 'ada-guid', role: 'speaker', isPrimary: true, sortOrder: 0 },
    ])
  })

  it('imports a service session as agenda furniture, never as a submission (trap 3)', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)

    expect(result.submissions.map((s) => s.title)).toEqual(['Shipping on Workers'])
    expect(result.agendaItems).toEqual([
      {
        remoteId: '14099',
        title: 'Lunch',
        roomRemoteId: '7',
        startsAt: undefined,
        endsAt: undefined,
      },
    ])
  })

  it('can only produce accepted submissions and never asks for review (trap 2)', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)

    expect(result.submissions[0].status).toBe('accepted')
    expect(result.submissions[0].reviewRequired).toBe(false)
  })

  it('applies only the confirmed categories, and names the one it skipped (trap 4)', () => {
    const result = normalizeSessionize(sessionize(), MAPPING)
    const talk = result.submissions[0]

    expect(talk.trackRemoteId).toBe('101')
    expect(talk.level).toBe('Advanced')
    expect(talk.format).toBe('Workshop')
    // `Sponsor tier` was never confirmed, so it is dropped and the organizer is told.
    expect(talk.tagRemoteIds).toEqual([])
    expect(result.tracks).toEqual([{ remoteId: '101', name: 'Platform', order: undefined }])
    expect(result.warnings).toEqual(['Category "Sponsor tier" was not mapped, so it was skipped.'])
  })
})

const AE_SESSIONS = [
  {
    id: '900',
    title: 'Bodo wrote this one',
    startTime: '2026-09-01T09:00:00Z',
    tracks: [],
    tags: [],
    speakers: [],
  },
  {
    id: '901',
    title: 'Organizer wrote this one',
    tracks: [{ id: 'tr1', name: 'Platform' }],
    tags: [{ id: 'tg1', name: 'AI' }],
    speakers: ['sp1'],
  },
]

describe('normalizeAccelevents', () => {
  it('skips remote ids bodo authored, and counts them', () => {
    const result = normalizeAccelevents(
      { sessions: AE_SESSIONS, speakers: [{ id: 'sp1', email: 'ada@example.com' }] },
      { authoredRemoteIds: new Set(['900']) },
    )

    expect(result.submissions.map((s) => s.remoteId)).toEqual(['901'])
    expect(result.skipped).toEqual({ speakers: 0, submissions: 1 })
    expect(result.warnings[0]).toContain('1 session(s) and 0 speaker(s)')
  })

  it('imports everything when bodo has never pushed to the event', () => {
    const result = normalizeAccelevents(
      { sessions: AE_SESSIONS, speakers: [] },
      { authoredRemoteIds: new Set() },
    )

    expect(result.submissions).toHaveLength(2)
    expect(result.skipped).toEqual({ speakers: 0, submissions: 0 })
  })

  it('derives taxonomy from the expanded sessions', () => {
    const result = normalizeAccelevents(
      { sessions: [AE_SESSIONS[1]], speakers: [] },
      { authoredRemoteIds: new Set() },
    )

    expect(result.tracks).toEqual([{ remoteId: 'tr1', name: 'Platform' }])
    expect(result.tags).toEqual([{ remoteId: 'tg1', name: 'AI' }])
    expect(result.warnings).toEqual([])
  })

  it('warns rather than silently importing a programme with no taxonomy', () => {
    // The unverified assumption in 5.0e: there is no list endpoint for tags and tracks,
    // so if `expand` does not hydrate them the import has none. That has to be visible.
    const result = normalizeAccelevents(
      { sessions: [AE_SESSIONS[0]], speakers: [] },
      { authoredRemoteIds: new Set() },
    )

    expect(result.tracks).toEqual([])
    expect(result.warnings.join(' ')).toContain('No tracks or tags came back on 1 session(s)')
  })
})

describe('reporting', () => {
  it('counts a dry run as all creates, with the round-trip skips beside them', () => {
    const counts = previewCounts(
      normalizeAccelevents(
        { sessions: AE_SESSIONS, speakers: [{ id: 'sp1', email: 'ada@example.com' }] },
        { authoredRemoteIds: new Set(['900']) },
      ),
    )

    expect(counts.submission).toEqual({ created: 1, updated: 0, skipped: 1 })
    expect(counts.speaker).toEqual({ created: 1, updated: 0, skipped: 0 })
    expect(counts.participant).toEqual({ created: 1, updated: 0, skipped: 0 })
    expect(counts.track).toEqual({ created: 1, updated: 0, skipped: 0 })
  })

  it('completes the needs-email rows once the DAL knows the local ids', () => {
    const pending = [
      { name: 'Ada Okafor', remoteId: 'ada-guid' },
      { name: 'Bo Lin', remoteId: 'bo-guid' },
    ]

    expect(toNeedsEmailRows(pending, new Map([['ada-guid', 'recAda']]))).toEqual([
      { name: 'Ada Okafor', remoteId: 'ada-guid', speakerId: 'recAda' },
    ])
  })
})
