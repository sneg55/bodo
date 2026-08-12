// The Sessionboard read client. Three things are worth a test and the rest is Zod:
// pagination that must reach the last page, a region that must reach the right host, and
// a token that must never reach a log line.

import { describe, expect, it } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { normalizeSessionboard } from '@/features/imports/normalize'
import {
  createSessionboardClient,
  type FetchLike,
  SESSIONBOARD_BASE_URLS,
} from '@/services/imports/sessionboard'

const TOKEN = 'sbtok_live_do_not_log_me'

type Call = { url: string; init?: RequestInit }

function recorder(pages: readonly unknown[]): { calls: Call[]; transport: FetchLike } {
  const calls: Call[] = []
  let index = 0
  const transport: FetchLike = (url, init) => {
    calls.push({ url, init })
    const body = pages[Math.min(index, pages.length - 1)]
    index += 1
    return Promise.resolve(new Response(JSON.stringify(body)))
  }
  return { calls, transport }
}

const session = (id: number) => ({ id, title: `S${id}`, is_abstract: false })
const fullPage = (offset: number) => Array.from({ length: 100 }, (_, i) => session(offset + i))

describe('sessionboard pagination', () => {
  it('pages to completion rather than returning the first page', async () => {
    const { calls, transport } = recorder([
      { results: fullPage(1), pagination: { totalPages: 2 } },
      { results: [session(101), session(102)], pagination: { totalPages: 2 } },
    ])
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    const sessions = await client.searchSessions('42')

    expect(sessions).toHaveLength(102)
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('page=1&pageSize=100')
    expect(calls[1].url).toContain('page=2&pageSize=100')
  })

  it('stops on a short page even when pagination is absent entirely', async () => {
    const { calls, transport } = recorder([{ results: [session(1)] }])
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    expect(await client.listEvents()).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('reads rows under `data` as well as `results`', async () => {
    // Their own description flags that the search answers under `results` "(not `data`)".
    // Accepting only one name would import an endpoint using the other as zero rows,
    // with a green run and no error anywhere.
    const { transport } = recorder([{ data: [session(1), session(2)] }])
    const client = createSessionboardClient({ region: 'eu', token: TOKEN }, transport)

    expect(await client.searchSessions('42')).toHaveLength(2)
  })

  it('imports is_abstract rather than inferring it', async () => {
    const { transport } = recorder([
      { results: [{ id: 1, title: 'CFP', is_abstract: true, status: 'pending' }] },
    ])
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    const [row] = await client.searchSessions('42')
    expect(row.is_abstract).toBe(true)
    expect(row.status).toBe('pending')
  })
})

describe('sessionboard connection', () => {
  it('sends the token as x-access-token against the region host', async () => {
    const { calls, transport } = recorder([{ results: [] }])
    const client = createSessionboardClient({ region: 'eu', token: TOKEN }, transport)

    await client.listContacts('42')

    expect(calls[0].url.startsWith(SESSIONBOARD_BASE_URLS.eu)).toBe(true)
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-access-token']).toBe(TOKEN)
  })

  it('uses the US host for a US connection', async () => {
    const { calls, transport } = recorder([{ results: [] }])
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    await client.listSetting('42', 'tracks')

    expect(calls[0].url.startsWith(SESSIONBOARD_BASE_URLS.us)).toBe(true)
    expect(calls[0].url).toContain('/v1/event/42/tracks')
  })

  it('searches sessions with POST, which is the only endpoint carrying filters', async () => {
    const { calls, transport } = recorder([{ results: [] }])
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    await client.searchSessions('42')

    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].url).toContain('/v1/event/42/sessions')
  })

  it('never puts the token in an error context', async () => {
    const transport: FetchLike = () => Promise.resolve(new Response('boom', { status: 500 }))
    const client = createSessionboardClient({ region: 'us', token: TOKEN }, transport)

    await client.listEvents().then(
      () => expect.unreachable('the read should have thrown'),
      (error: unknown) => {
        const thrown = error as { id: string; context: Record<string, unknown>; message: string }
        expect(thrown.id).toBe(ErrorIds.NET_UNAVAILABLE)
        expect(JSON.stringify(thrown.context)).not.toContain(TOKEN)
        expect(thrown.message).not.toContain(TOKEN)
      },
    )
  })

  it('reports a rejected token distinctly from a missing event', async () => {
    const unauthorized = createSessionboardClient({ region: 'us', token: TOKEN }, () =>
      Promise.resolve(new Response('nope', { status: 401 })),
    )
    const missing = createSessionboardClient({ region: 'us', token: TOKEN }, () =>
      Promise.resolve(new Response('nope', { status: 404 })),
    )

    await expect(unauthorized.listEvents()).rejects.toMatchObject({
      id: ErrorIds.AUTH_TOKEN_INVALID,
    })
    await expect(missing.listSpeakers('42')).rejects.toMatchObject({
      id: ErrorIds.DATA_RECORD_NOT_FOUND,
    })
  })
})

const SB_SESSION = {
  id: 's1',
  title: 'Panel',
  is_abstract: true,
  status: 'accept_queue',
  starts_at: '2026-09-01T09:00:00Z',
  track: { id: 't1', name: 'Platform' },
  tags: [{ id: 'g1', name: 'AI' }],
  room: { id: 'r1', name: 'Main Hall' },
  participants: [
    { contact_id: 'c1', role: 'speaker', is_primary: true, sort_order: 0 },
    { contact_id: 'c2', role: 'panelist', is_primary: false, sort_order: 1 },
  ],
  // Legacy junction arrays are deliberately absent from the schema: reading them would
  // double-count anyone appearing in two of the three.
  speakers: [{ id: 'c9' }],
}

describe('normalizeSessionboard', () => {
  it('takes reviewRequired from is_abstract rather than from status', () => {
    const result = normalizeSessionboard({
      sessions: [SB_SESSION, { ...SB_SESSION, id: 's2', is_abstract: false, status: 'accepted' }],
      contacts: [],
    })

    expect(result.submissions[0]).toMatchObject({ reviewRequired: true, status: 'accept_queue' })
    expect(result.submissions[1]).toMatchObject({ reviewRequired: false, status: 'accepted' })
  })

  it('builds participants from `participants` and not from the legacy arrays', () => {
    const result = normalizeSessionboard({ sessions: [SB_SESSION], contacts: [] })

    expect(result.submissions[0].participants).toEqual([
      { speakerRemoteId: 'c1', role: 'speaker', isPrimary: true, sortOrder: 0 },
      { speakerRemoteId: 'c2', role: 'co_speaker', isPrimary: false, sortOrder: 1 },
    ])
    expect(JSON.stringify(result.submissions[0].participants)).not.toContain('c9')
  })

  it('names a custom role it had to degrade instead of dropping the person', () => {
    const result = normalizeSessionboard({ sessions: [SB_SESSION], contacts: [] })

    expect(result.warnings).toContain(
      'Participant roles bodo has no equivalent for were imported as Speaker or Co-Speaker: panelist.',
    )
  })

  it('names an unrecognised status and lands it on pending', () => {
    const result = normalizeSessionboard({
      sessions: [{ ...SB_SESSION, status: 'shortlisted' }],
      contacts: [],
    })

    expect(result.submissions[0].status).toBe('pending')
    expect(result.warnings).toContain(
      'Session statuses bodo does not recognise were imported as Pending: shortlisted.',
    )
  })

  it('keeps a taxonomy that only appears on a session', () => {
    const result = normalizeSessionboard({ sessions: [SB_SESSION], contacts: [] })

    expect(result.tracks).toEqual([{ remoteId: 't1', name: 'Platform' }])
    expect(result.tags).toEqual([{ remoteId: 'g1', name: 'AI' }])
    expect(result.submissions[0].roomRemoteId).toBe('r1')
  })

  it("maps a contact onto bodo's Speaker field for field", () => {
    const result = normalizeSessionboard({
      sessions: [],
      contacts: [
        {
          id: 'c1',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Okafor',
          company_name: 'Northwind',
          title: 'Staff Engineer',
          about: 'Builds things.',
          phone_mobile: '+1 555 0100',
          photo_url: 'https://example.com/a.jpg',
          linkedin_url: 'https://linkedin.com/in/ada',
          twitter_url: 'https://x.com/ada',
          pronouns: 'she/her',
        },
      ],
    })

    expect(result.speakers[0]).toMatchObject({
      remoteId: 'c1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      company: 'Northwind',
      tagline: 'Staff Engineer',
      bio: 'Builds things.',
      phone: '+1 555 0100',
      pronouns: 'she/her',
      links: { linkedin: 'https://linkedin.com/in/ada', x: 'https://x.com/ada' },
    })
  })
})
