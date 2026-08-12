// The scheduler is the only thing between the app and Airtable's 5 req/s per
// base, so its two jobs are asserted separately: spacing (how often a request is
// allowed out) and retry (what happens when one comes back 429 or 5xx).
//
// No real timers and no real network. The clock, the sleeper, the jitter source
// and fetch are all injected, which is the whole reason those are parameters.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import {
  type Clock,
  computeBackoffMs,
  createScheduler,
  parseRetryAfterMs,
} from '@/services/airtable/scheduler'

type TestClock = Clock & { sleeps: number[]; advance: (ms: number) => void }

/**
 * Virtual clock. Each sleep records its duration and jumps the clock forward by it, so a
 * sleep here always runs to its deadline and never has to be fired by hand. That is what
 * these two properties want, and it is also what they can assert: a sleep that resolves as
 * soon as it is asked for can never be seen losing a race, which is why the tests about
 * interrupting a wait live in tests/airtable-rate-window.test.ts on a clock that can defer.
 */
function testClock(): TestClock {
  let now = 0
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms)
      now += ms
      return { done: Promise.resolve(), wake: () => undefined }
    },
    sleeps,
    advance: (ms: number) => {
      now += ms
    },
  }
}

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '{}', { status, headers })
}

/**
 * A round trip that takes time, because a network call does.
 *
 * Above the scheduler's cache-hit ceiling on purpose: a call that returns faster than that
 * is read as served from cache and gets its rate-limit slot refunded, so a fake resolving
 * instantly would model a cache hit rather than a request to Airtable. 150ms is also
 * roughly the real median measured from a Worker, where Airtable samples ran 115ms to
 * 712ms and cache reads ran 3ms to 45ms.
 */
const FAKE_LATENCY_MS = 150

/** Replays the given statuses in order, recording the clock time of each call. */
function scriptedFetch(clock: TestClock, statuses: readonly (number | 'throw')[]) {
  const calls: number[] = []
  const fetchImpl = (): Promise<Response> => {
    const index = calls.length
    calls.push(clock.now())
    clock.advance(FAKE_LATENCY_MS)
    const next = statuses.at(index) ?? statuses.at(-1)
    if (next === 'throw' || next === undefined) {
      return Promise.reject(new TypeError('network down'))
    }
    return Promise.resolve(response(next))
  }
  return { fetchImpl, calls }
}

const URL_A = 'https://api.airtable.com/v0/appTest/Submissions'

describe('createScheduler rate cap', () => {
  it('spaces awaited requests at one per 1/rps', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, [200])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    await scheduler.fetch(URL_A)
    await scheduler.fetch(URL_A)
    await scheduler.fetch(URL_A)

    // 5 req/s is a 200ms slot. The first request owes nothing; each later one waits only
    // for the REMAINDER of its slot, because the time the previous round trip already
    // spent counts toward the spacing. So a 150ms call leaves 50ms to wait. The asserted
    // property is the one that matters: requests still LEAVE 200ms apart.
    expect(calls).toEqual([0, 200, 400])
    expect(clock.sleeps).toEqual([50, 50])
  })

  it('gives concurrent requests distinct slots instead of letting them burst', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, [200])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    await Promise.all([
      scheduler.fetch(URL_A),
      scheduler.fetch(URL_A),
      scheduler.fetch(URL_A),
      scheduler.fetch(URL_A),
      scheduler.fetch(URL_A),
    ])

    // Five calls fired at once: the first goes immediately, the rest each wait for their
    // own slot. Without the window they would all leave together and trip the rate cap.
    //
    // Asserted on the instant each request LEFT rather than on the sleeps, because the
    // sleeps are remainders: whatever time the preceding round trips already consumed is
    // deducted from the wait. Departure times are what the cap is actually about, and
    // they are also what a reader can check against "5 per second" by eye.
    expect(calls).toEqual([0, 200, 400, 600, 800])
  })
})

// What the cap does about Next's fetch cache lives in tests/airtable-rate-window.test.ts:
// a cache hit hands its slot back, a fast 429 does not, and a burst of hits does not pay a
// slot each. Those need a clock whose sleep can be interrupted, which this one cannot do
// (its sleep resolves the moment it is asked for), so they are asserted next to the
// algorithm instead of here.

// Retry behaviour is asserted with the rate cap lifted, so every sleep in the
// list is a backoff and the numbers mean what they say.
const NO_CAP = { requestsPerSecond: Number.POSITIVE_INFINITY, random: () => 0 }

describe('createScheduler retries', () => {
  it('retries a 429 and returns the eventual success', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, [429, 200])
    const scheduler = createScheduler({ ...NO_CAP, clock, fetchImpl, baseBackoffMs: 500 })

    const result = await scheduler.fetch(URL_A)

    expect(result.status).toBe(200)
    expect(calls).toHaveLength(2)
    // jitter pinned to 0, so the delay is the low half of the 500ms window.
    expect(clock.sleeps).toEqual([250])
  })

  it('honours Retry-After instead of its own backoff', async () => {
    const clock = testClock()
    let served = 0
    const scheduler = createScheduler({
      ...NO_CAP,
      clock,
      baseBackoffMs: 500,
      fetchImpl: () => {
        served += 1
        return Promise.resolve(served === 1 ? response(429, { 'retry-after': '2' }) : response(200))
      },
    })

    await scheduler.fetch(URL_A)

    expect(clock.sleeps).toEqual([2000])
  })

  it('backs off exponentially across repeated 5xx', async () => {
    const clock = testClock()
    const { fetchImpl } = scriptedFetch(clock, [503, 502, 500, 200])
    const scheduler = createScheduler({
      ...NO_CAP,
      clock,
      fetchImpl,
      maxAttempts: 4,
      baseBackoffMs: 100,
    })

    await scheduler.fetch(URL_A)

    expect(clock.sleeps).toEqual([50, 100, 200])
  })

  it('gives up on a persistent 429 with DATA_RATE_LIMITED', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, [429])
    const scheduler = createScheduler({ ...NO_CAP, clock, fetchImpl, maxAttempts: 3 })

    const thrown = await scheduler.fetch(URL_A).catch((error: unknown) => error)

    expect(isAppError(thrown)).toBe(true)
    expect(isAppError(thrown) ? thrown.id : '').toBe('E_DATA_004')
    // Bounded: three attempts, not an unbounded loop.
    expect(calls).toHaveLength(3)
  })

  it('gives up on a persistent transport failure with NET_UNAVAILABLE', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, ['throw'])
    const scheduler = createScheduler({ ...NO_CAP, clock, fetchImpl, maxAttempts: 2 })

    const thrown = await scheduler.fetch(URL_A).catch((error: unknown) => error)

    expect(isAppError(thrown) ? thrown.id : '').toBe('E_NET_005')
    expect(calls).toHaveLength(2)
  })

  it('gives up on a persistent 5xx with NET_UNAVAILABLE', async () => {
    const clock = testClock()
    const { fetchImpl } = scriptedFetch(clock, [500])
    const scheduler = createScheduler({ ...NO_CAP, clock, fetchImpl, maxAttempts: 2 })

    const thrown = await scheduler.fetch(URL_A).catch((error: unknown) => error)

    expect(isAppError(thrown) ? thrown.id : '').toBe('E_NET_005')
  })

  it('does not retry a 4xx that is not 429', async () => {
    const clock = testClock()
    const { fetchImpl, calls } = scriptedFetch(clock, [422])
    const scheduler = createScheduler({ ...NO_CAP, clock, fetchImpl })

    const result = await scheduler.fetch(URL_A)

    // A 422 is a bad request, not congestion. Retrying it just spends budget.
    expect(result.status).toBe(422)
    expect(calls).toHaveLength(1)
    expect(clock.sleeps).toEqual([])
  })

  it('caps an absurd Retry-After so one bad header cannot hang a request', async () => {
    const clock = testClock()
    const scheduler = createScheduler({
      ...NO_CAP,
      clock,
      maxAttempts: 2,
      retryAfterCapMs: 5_000,
      fetchImpl: () => Promise.resolve(response(429, { 'retry-after': '86400' })),
    })

    await scheduler.fetch(URL_A).catch(() => undefined)

    expect(clock.sleeps).toEqual([5_000])
  })
})

describe('parseRetryAfterMs', () => {
  it('reads a delay in seconds', () => {
    expect(parseRetryAfterMs('30', 0)).toBe(30_000)
  })

  it('reads an HTTP date relative to the injected clock', () => {
    const now = Date.parse('2026-08-08T12:00:00.000Z')
    expect(parseRetryAfterMs('Sat, 08 Aug 2026 12:00:10 GMT', now)).toBe(10_000)
  })

  it('never returns a negative delay for a date already past', () => {
    const now = Date.parse('2026-08-08T12:00:00.000Z')
    expect(parseRetryAfterMs('Sat, 08 Aug 2026 11:59:00 GMT', now)).toBe(0)
  })

  it('returns undefined for an absent or unparseable header', () => {
    expect(parseRetryAfterMs(null, 0)).toBeUndefined()
    expect(parseRetryAfterMs('soon', 0)).toBeUndefined()
  })
})

describe('computeBackoffMs', () => {
  it('doubles per attempt and stays inside the jitter window', () => {
    const options = { baseBackoffMs: 100, maxBackoffMs: 10_000 }
    expect(computeBackoffMs(1, { ...options, jitter: 0 })).toBe(50)
    expect(computeBackoffMs(1, { ...options, jitter: 1 })).toBe(100)
    expect(computeBackoffMs(3, { ...options, jitter: 1 })).toBe(400)
  })

  it('clamps at the ceiling', () => {
    expect(computeBackoffMs(20, { baseBackoffMs: 100, maxBackoffMs: 1_000, jitter: 1 })).toBe(1_000)
  })
})
