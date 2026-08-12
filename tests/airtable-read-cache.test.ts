// The cache used to be a `'use cache'` function per read, where a missing `cacheTag`
// was at least visible in the source. It is on the request now (read-cache.ts explains
// why), which means a read that forgets its tags still works, still looks correct, and
// is simply never invalidated. So the plumbing is asserted here, at all three levels it
// has to hold at:
//
//   1. `cacheInit` turns a read's declaration into a RequestInit, and a write into
//      `no-store` no matter what it is handed.
//   2. The client threads a read's tags onto every request it makes, including page two
//      of a paginated list, and never onto a write.
//   3. The real read functions declare the tags the mutations actually invalidate, and
//      the three reads that must stay uncached still are.
//
// Level 3 stubs the global `fetch` rather than the client, because the point is what
// reaches the network: a tag that is dropped between the read and the request is exactly
// the bug this file exists to catch.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClient } from '@/services/airtable/client'
import { cacheInit, REVALIDATE } from '@/services/airtable/read-cache'
import type { Scheduler } from '@/services/airtable/scheduler'

const TAGS = ['event:recE1:submissions']

describe('cacheInit', () => {
  it('turns a read with a window into next.tags and next.revalidate', () => {
    const init = cacheInit('read', { tags: TAGS, revalidate: 60 })

    expect(init.next).toEqual({ revalidate: 60, tags: TAGS })
    // Not both: `no-store` alongside a revalidate window is a contradiction Next warns
    // about, and the entry it produces is the one nobody wanted.
    expect(init.cache).toBeUndefined()
  })

  it('does not cache a read that names tags but no window', () => {
    // Tags alone would cache nothing and invalidate nothing, so the honest answer is
    // an uncached request rather than a cached one nobody can expire.
    const init = cacheInit('read', { tags: TAGS })

    expect(init.cache).toBe('no-store')
    expect(init.next).toBeUndefined()
  })

  it('never caches a write, even when handed a full read cache', () => {
    const init = cacheInit('write', { tags: TAGS, revalidate: 3_600 })

    expect(init.cache).toBe('no-store')
    expect(init.next).toBeUndefined()
  })

  it('keeps the two windows apart and in seconds', () => {
    // The numbers the removed cacheLife profiles resolved to. Changing one silently
    // changes how stale a screen an organizer just edited is allowed to be.
    expect(REVALIDATE.edited).toBe(60)
    expect(REVALIDATE.lookup).toBe(3_600)
  })
})

/** A scheduler that replays bodies and keeps every RequestInit it was handed. */
function fakeScheduler(bodies: readonly unknown[]) {
  const inits: RequestInit[] = []
  const scheduler: Scheduler = {
    fetch: (_url, init) => {
      const body = bodies.at(inits.length) ?? bodies.at(-1)
      inits.push(init ?? {})
      return Promise.resolve(
        new Response(JSON.stringify(body ?? {}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    },
  }
  return { inits, api: createClient({ baseId: 'appTest', token: 'patTest', scheduler }) }
}

describe('the client threads a read cache onto the request', () => {
  it('tags every page of a paginated list, not just the first', async () => {
    const { api, inits } = fakeScheduler([{ records: [], offset: 'page2' }, { records: [] }])

    await api.listAll('Submissions', { tags: TAGS, revalidate: 60 })

    // A list whose second page is uncached is a list that is half expired by its own
    // tag, which is the same permanently-wrong answer pagination-to-completion exists
    // to prevent.
    expect(inits).toHaveLength(2)
    expect(inits.map((init) => init.next)).toEqual([
      { revalidate: 60, tags: TAGS },
      { revalidate: 60, tags: TAGS },
    ])
  })

  it('leaves a list uncached when the read declares no window', async () => {
    const { api, inits } = fakeScheduler([{ records: [] }])

    await api.listAll('EmailOutbox')

    expect(inits.at(0)?.cache).toBe('no-store')
    expect(inits.at(0)?.next).toBeUndefined()
  })

  it('passes a single record read its tags', async () => {
    const { api, inits } = fakeScheduler([{ id: 'recE1', fields: {} }])

    await api.getRecord('Events', 'recE1', { tags: ['event:recE1'], revalidate: 3_600 })

    expect(inits.at(0)?.next).toEqual({ revalidate: 3_600, tags: ['event:recE1'] })
  })

  it('never caches a create, an update or a delete', async () => {
    const { api, inits } = fakeScheduler([{ records: [{ id: 'rec1', fields: {} }] }])

    await api.createRecords('Submissions', [{ title: 'x' }])
    await api.updateRecords('Submissions', [{ id: 'rec1', fields: { status: 'accepted' } }])
    await api.deleteRecords('Reviews', ['rec1'])

    expect(inits).toHaveLength(3)
    for (const init of inits) {
      // A cached write is a mutation that silently did not happen, and an entry keyed
      // on the request would answer the retry too.
      expect(init.cache).toBe('no-store')
      expect(init.next).toBeUndefined()
    }
  })
})

// ── Level 3: the real reads, through a stubbed global fetch ───────────────────

type Call = { url: string; init: RequestInit }

const ORIGINAL_ENV = { ...process.env }

/**
 * Load the live reads with credentials configured and `fetch` captured.
 *
 * Credentials matter: with none, `getSource()` serves fixtures and never issues a
 * request, so a test that skipped this would assert nothing at all. The modules are
 * reset so the env boundary and the per-base scheduler are both rebuilt per test.
 */
async function loadReads(): Promise<{
  calls: Call[]
  reads: typeof import('@/services/airtable/reads')
  review: typeof import('@/services/airtable/reads-review')
  portal: typeof import('@/services/airtable/reads-portal')
  identity: typeof import('@/services/airtable/reads-identity')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} })
    return Promise.resolve(
      new Response(JSON.stringify(recordsFor(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return {
    calls,
    reads: await import('@/services/airtable/reads'),
    review: await import('@/services/airtable/reads-review'),
    portal: await import('@/services/airtable/reads-portal'),
    identity: await import('@/services/airtable/reads-identity'),
  }
}

/** Just enough of an Airtable answer to get through Zod. Lists come back empty. */
function recordsFor(url: string): unknown {
  if (url.includes('/Events/rec')) {
    return { id: 'recE1', fields: { name: 'AI Engineer', slug: 'ai-engineer' } }
  }
  if (url.includes('/Speakers/rec')) {
    return { id: 'recSpk1', fields: { email: 'speaker@example.com' } }
  }
  return { records: [] }
}

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('a live read declares the tags its writes invalidate', () => {
  it('tags the event record and gives it the lookup window', async () => {
    const { reads, calls } = await loadReads()

    await reads.getEvent('recE1')

    expect(calls.at(0)?.init.next).toEqual({
      revalidate: REVALIDATE.lookup,
      tags: ['event:recE1'],
    })
  })

  it('subscribes the submission list to every screen served from the same request', async () => {
    const { reads, calls } = await loadReads()

    await reads.listSubmissions('recE1')

    // Three requests: submissions, participants, speakers. All three are the cache
    // entry behind the abstracts table, the agenda and the public agenda, so all three
    // carry the tags any of those screens' writes expire.
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.init.next).toEqual({
        revalidate: REVALIDATE.edited,
        tags: [
          'event:recE1:submissions',
          'event:recE1:agenda',
          'event:recE1:agenda:published',
          'event:recE1:speakers',
        ],
      })
    }
  })

  it('tags one speaker per speaker, not per event', async () => {
    const { review, calls } = await loadReads()

    await review.getSpeaker('recSpk1')

    expect(calls.at(0)?.init.next).toEqual({
      revalidate: REVALIDATE.edited,
      tags: ['speaker:recSpk1'],
    })
  })

  it('tags a task list with both the speaker and the event', async () => {
    const { portal, calls } = await loadReads()

    await portal.listTaskAssignmentsForSpeaker('recE1', 'recSpk1')

    // A speaker ticking a task off expires their own list; an organizer fanning tasks
    // out on accept expires everybody's without knowing who is affected.
    const tags = calls.map((call) => call.init.next?.tags)
    expect(tags).toEqual([
      ['speaker:recSpk1:tasks', 'event:recE1:tasks'],
      ['speaker:recSpk1:tasks', 'event:recE1:tasks'],
    ])
  })
})

describe('the reads that must not be cached', () => {
  it('leaves the outbox due-list uncached', async () => {
    const { portal, calls } = await loadReads()

    await portal.listDueOutbox('recE1', '2026-01-01T00:00:00.000Z', 10)

    // A cached due-list hands a second cron invocation rows the first has already
    // sent, which is a speaker receiving the same acceptance email twice.
    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })

  it('leaves the idempotency-key lookup uncached', async () => {
    const { portal, calls } = await loadReads()

    await portal.existingOutboxKeys(['k1'])

    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })

  it('leaves an identity lookup uncached', async () => {
    const { identity, calls } = await loadReads()

    await identity.findSpeakerByEmail('speaker@example.com')

    // An account created seconds ago must be able to log in, and a cached miss is a
    // speaker locked out of their own portal.
    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })

  it('leaves the review lookup a mutation decides from uncached', async () => {
    const { review, calls } = await loadReads()

    await review.findReview({ submissionId: 'recS1', roundId: 'recR1', reviewerId: 'recU1' })

    expect(calls.at(0)?.init.cache).toBe('no-store')
    expect(calls.at(0)?.init.next).toBeUndefined()
  })
})
