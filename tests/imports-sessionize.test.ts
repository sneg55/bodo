// The Sessionize boundary, and the four traps BUILD_SPEC 5.0e records as observed in
// the live payload. Each one is silent in production if the workaround regresses, which
// is exactly why they are pinned here rather than left to the type checker.

import { describe, expect, it } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import {
  type FetchLike,
  fetchSessionizeAll,
  parseSessionizeAll,
  SESSIONIZE_API_ROOT,
  sessionizeSpeakerSchema,
} from '@/services/imports/sessionize'

/** Shaped like the documented demo event `jl4ktls0`, including its `Lunch`. */
const PAYLOAD = {
  sessions: [
    {
      id: '14022',
      title: 'Shipping on Workers',
      description: 'A talk.',
      startsAt: '2026-09-01T09:00:00Z',
      endsAt: '2026-09-01T09:45:00Z',
      isServiceSession: false,
      isPlenumSession: false,
      speakers: ['b7c1-guid'],
      categoryItems: [101, 201],
      questionAnswers: [],
      roomId: 7,
      liveUrl: null,
      recordingUrl: null,
      status: 'Accepted',
      isInformed: true,
      isConfirmed: true,
    },
    {
      id: '14099',
      title: 'Lunch',
      description: null,
      startsAt: '2026-09-01T12:00:00Z',
      endsAt: '2026-09-01T13:00:00Z',
      isServiceSession: true,
      isPlenumSession: false,
      speakers: [],
      categoryItems: [],
      questionAnswers: [],
      roomId: 7,
      status: null,
    },
  ],
  speakers: [
    {
      id: 'b7c1-guid',
      firstName: 'Ada',
      lastName: 'Okafor',
      fullName: 'Ada Okafor',
      bio: 'Builds things.',
      tagLine: 'Staff Engineer, Northwind',
      profilePicture: 'https://example.com/a.jpg',
      isTopSpeaker: true,
      links: [{ title: 'LinkedIn', url: 'https://linkedin.com/in/ada', linkType: 'LinkedIn' }],
      // Integers here, string on `session.id` above. This is trap 1 in one payload.
      sessions: [14022],
      categoryItems: [],
      questionAnswers: [],
    },
  ],
  rooms: [{ id: 7, name: 'Main Hall', sort: 1 }],
  categories: [
    {
      id: 1,
      title: 'Track',
      items: [{ id: 101, name: 'Platform', sort: 0 }],
      sort: 0,
      type: 'session',
    },
    {
      id: 2,
      title: 'Level',
      items: [{ id: 201, name: 'Advanced', sort: 0 }],
      sort: 1,
      type: 'session',
    },
  ],
  questions: [{ id: 5, question: 'Recording ok?', questionType: 'Boolean', sort: 0 }],
}

const respondWith = (body: string, status = 200): FetchLike => {
  return () => Promise.resolve(new Response(body, { status }))
}

describe('sessionize boundary', () => {
  it('coerces both id spellings to string so the join can match (trap 1)', () => {
    const parsed = parseSessionizeAll(JSON.stringify(PAYLOAD), 'demo')

    expect(parsed.sessions[0].id).toBe('14022')
    // Integer on the way in, string on the way out. Without this the reverse link
    // compares 14022 with '14022' and quietly matches nothing.
    expect(parsed.speakers[0].sessions).toEqual(['14022'])
    expect(parsed.sessions[0].roomId).toBe('7')
    expect(parsed.sessions[0].categoryItems).toEqual(['101', '201'])
    expect(parsed.rooms[0].id).toBe('7')
    expect(parsed.categories[0].items[0].id).toBe('101')
  })

  it('accepts a service session carrying a null status (trap 3)', () => {
    const parsed = parseSessionizeAll(JSON.stringify(PAYLOAD), 'demo')
    const lunch = parsed.sessions[1]

    expect(lunch.status).toBeNull()
    expect(lunch.isServiceSession).toBe(true)
    expect(lunch.speakers).toEqual([])
  })

  it('carries no email field on a speaker at all', () => {
    const parsed = parseSessionizeAll(JSON.stringify(PAYLOAD), 'demo')

    // The schema is the contract: even if a payload smuggled one in, it is stripped, so
    // nothing downstream can read an address off this source and believe it.
    expect(Object.keys(parsed.speakers[0])).not.toContain('email')
    const smuggled = sessionizeSpeakerSchema.parse({ id: '1', email: 'x@example.com' })
    expect(Object.keys(smuggled)).not.toContain('email')
  })

  it('keeps user-named categories as-is rather than typing them (trap 4)', () => {
    const parsed = parseSessionizeAll(JSON.stringify(PAYLOAD), 'demo')

    expect(parsed.categories.map((c) => c.title)).toEqual(['Track', 'Level'])
    expect(parsed.categories.every((c) => c.type === 'session')).toBe(true)
  })

  it('asks for the All view on the documented root, once', async () => {
    const seen: string[] = []
    const transport: FetchLike = (input) => {
      seen.push(input)
      return Promise.resolve(new Response(JSON.stringify(PAYLOAD)))
    }

    await fetchSessionizeAll('jl4ktls0', { fetchImpl: transport })

    expect(seen).toEqual([`${SESSIONIZE_API_ROOT}/jl4ktls0/view/All`])
  })

  it('reports a wrong endpoint id as not found rather than as a read failure', async () => {
    await expect(
      fetchSessionizeAll('nope', { fetchImpl: respondWith('', 404) }),
    ).rejects.toMatchObject({ id: ErrorIds.DATA_RECORD_NOT_FOUND })
  })

  it('names the XML-format mistake when the body is not JSON', async () => {
    await expect(
      fetchSessionizeAll('demo', { fetchImpl: respondWith('<sessions/>') }),
    ).rejects.toMatchObject({ id: ErrorIds.NET_BAD_SHAPE })
  })

  it('turns a transport rejection into an id the run row can record', async () => {
    const transport: FetchLike = () => Promise.reject(new Error('socket hang up'))

    await expect(fetchSessionizeAll('demo', { fetchImpl: transport })).rejects.toMatchObject({
      id: ErrorIds.NET_UNAVAILABLE,
    })
  })

  it('rejects an empty endpoint id before opening a socket', async () => {
    let called = false
    const transport: FetchLike = () => {
      called = true
      return Promise.resolve(new Response('{}'))
    }

    await expect(fetchSessionizeAll('  ', { fetchImpl: transport })).rejects.toMatchObject({
      id: ErrorIds.NET_BAD_SHAPE,
    })
    expect(called).toBe(false)
  })
})
