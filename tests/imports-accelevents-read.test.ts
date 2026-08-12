// The Accelevents read client. Its paths are the unverified part of BUILD_SPEC 5.0e, so
// what is pinned here is the behaviour around them: the key never comes from ambient env
// when one is supplied, a refused admin read is distinguishable so the run can fall back
// to the portal endpoint, and both response envelopes page to completion.

import { describe, expect, it } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import {
  ACCEL_READ_PATHS,
  createAccelReadClient,
  type FetchLike,
} from '@/services/imports/accelevents-read'

const KEY = 'ae_test_key'

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

const speaker = (id: number) => ({ id, email: `s${id}@example.com` })
const fullPage = (offset: number) => Array.from({ length: 100 }, (_, i) => speaker(offset + i))

describe('accelevents read client', () => {
  it('scopes the admin reads by eventId and asks for the expansion', async () => {
    const { calls, transport } = recorder([[]])
    const client = createAccelReadClient({ fetchImpl: transport, apiKey: KEY })

    await client.listSessions('ev-42')

    expect(calls[0].url).toContain(`${ACCEL_READ_PATHS.sessions}?eventId=ev-42`)
    expect(calls[0].url).toContain('expand=true')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.authorization).toBe(KEY)
  })

  it('reads the portal fallback by event url rather than by id', async () => {
    const { calls, transport } = recorder([[]])
    const client = createAccelReadClient({ fetchImpl: transport, apiKey: KEY })

    await client.listPortalSessions('ai-engineer-sandbox')

    expect(calls[0].url).toContain(ACCEL_READ_PATHS.portalSessions('ai-engineer-sandbox'))
  })

  it('accepts a bare array and a paged envelope alike', async () => {
    const bare = createAccelReadClient({
      fetchImpl: recorder([[speaker(1), speaker(2)]]).transport,
      apiKey: KEY,
    })
    const paged = createAccelReadClient({
      fetchImpl: recorder([
        { content: fullPage(1), totalPages: 2 },
        { content: [speaker(101)], totalPages: 2 },
      ]).transport,
      apiKey: KEY,
    })

    expect(await bare.listSpeakers('ev-42')).toHaveLength(2)
    // A paged response read as one page would import a third of an event and finish green.
    expect(await paged.listSpeakers('ev-42')).toHaveLength(101)
  })

  it('reports a refused admin read as an auth failure, which is the fallback signal', async () => {
    const client = createAccelReadClient({
      fetchImpl: () => Promise.resolve(new Response('denied', { status: 403 })),
      apiKey: KEY,
    })

    await expect(client.listSessions('ev-42')).rejects.toMatchObject({
      id: ErrorIds.ACCEL_AUTH_FAIL,
    })
  })

  it('separates a retryable outage from a rejected request', async () => {
    const down = createAccelReadClient({
      fetchImpl: () => Promise.resolve(new Response('', { status: 503 })),
      apiKey: KEY,
    })
    const rejected = createAccelReadClient({
      fetchImpl: () => Promise.resolve(new Response('nope', { status: 400 })),
      apiKey: KEY,
    })

    await expect(down.listSpeakers('ev-42')).rejects.toMatchObject({
      id: ErrorIds.ACCEL_UNAVAILABLE,
    })
    await expect(rejected.listSpeakers('ev-42')).rejects.toMatchObject({
      id: ErrorIds.ACCEL_BAD_REQUEST,
    })
  })
})
