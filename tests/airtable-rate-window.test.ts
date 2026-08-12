// The rate cap's hard part: a slot must not be charged to a call that never left the
// isolate, and handing one back must never let two real requests out closer than the cap.
//
// Everything here runs on a VIRTUAL clock whose `sleep` resolves only when the test fires
// it, and that is the difference that matters. A clock whose sleep resolves inline cannot
// show whether a refund cut a wait short, because the sleep always wins the moment it is
// asked for. Here a call that returns without sleeping leaves the clock exactly where it
// was, which is what a cache hit does, and a test that must NOT need a timer to fire can
// prove it by awaiting the work without firing one.
//
// Latencies are the measured populations from the deployed Worker: cache reads ran 3ms to
// 45ms, Airtable round trips 115ms to 712ms (BUILD_SPEC-implementation-notes.md).
//
// This file drives the window through a scheduler, so it sees what a caller pays. The
// tests that reach past that and call `admit` and `settle` by hand are in
// tests/airtable-rate-window-admission.test.ts.

import { describe, expect, it } from 'vitest'

import { CACHE_HIT_CEILING_MS, verdictFor } from '@/services/airtable/rate-window'
import { createScheduler } from '@/services/airtable/scheduler'

import {
  busiestSecond,
  runVirtual,
  type Trip,
  tracedFetch,
  virtualClock,
} from './helpers/virtual-clock'

const URL_A = 'https://api.airtable.com/v0/appTest/Submissions'
/** 5 requests per second is a 200ms slot. */
const SPACING_MS = 200
const CACHED_MS = 20
const NETWORK_MS = 150
const CACHED: Trip = { latencyMs: CACHED_MS, status: 200 }
const NETWORK: Trip = { latencyMs: NETWORK_MS, status: 200 }

describe('verdictFor', () => {
  // The one tuned number in the design, so it gets asserted directly rather than only
  // through the behaviour above. The measured populations it sits between are 3ms to 45ms
  // for cache reads and 115ms upward for Airtable, so the boundary is in empty space and
  // these cases are about pinning the comparison, not about the exact value being sacred.

  it('reads anything at or under the ceiling as a cache hit', () => {
    expect(verdictFor({ elapsedMs: 0, retryable: false })).toBe('cached')
    expect(verdictFor({ elapsedMs: 45, retryable: false })).toBe('cached')
    // Exactly on the boundary counts as cached: the comparison is `>`, and being wrong
    // high refunds a genuine request while being wrong low leaves latency on the table.
    expect(verdictFor({ elapsedMs: CACHE_HIT_CEILING_MS, retryable: false })).toBe('cached')
  })

  it('reads anything past the ceiling as a network call', () => {
    expect(verdictFor({ elapsedMs: CACHE_HIT_CEILING_MS + 1, retryable: false })).toBe('network')
    expect(verdictFor({ elapsedMs: 712, retryable: false })).toBe('network')
  })

  it('reads a retryable answer as a network call however fast it came back', () => {
    // A 429 answering in 0ms is the cap itself talking, and a retry is never free because
    // whatever refused the attempt before it has not gone anywhere. Treating either as a
    // hit would loosen the limiter exactly when it is proving necessary.
    expect(verdictFor({ elapsedMs: 0, retryable: true })).toBe('network')
  })

  it('keeps the ceiling inside the gap the measurement found', () => {
    // Guards the constant itself: 45ms was the slowest cache read observed and 115ms the
    // fastest round trip, so a future edit that moves this outside that gap is a
    // regression whichever way it goes.
    expect(CACHE_HIT_CEILING_MS).toBeGreaterThan(45)
    expect(CACHE_HIT_CEILING_MS).toBeLessThan(115)
  })
})

describe('a burst of cached reads', () => {
  it('does not pay a slot per read', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [CACHED])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    // Nine reads in one Promise.all is `loadAbstractsView`. Awaited WITHOUT firing the
    // clock on purpose: if any of them settled for waiting out a slot, nothing here would
    // ever resolve it and this test would hang instead of passing.
    await Promise.all(Array.from({ length: 9 }, () => scheduler.fetch(URL_A)))

    // Each read costs its own cache read and nothing else. Nine slots would have been
    // 1600ms of pure waiting, which is what the abstracts page was measured paying.
    expect(calls).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160])
    expect(clock.now()).toBe(180)
  })

  it('leaves the cursor where it started, not one slot per read ahead', async () => {
    // The assertion above cannot see this, which a mutation proved: delete the
    // `nextSlotAt = slotAt` rewind from `refund` and all of it still passes, because each
    // abort releases the next caller regardless of where the cursor ended up. The cursor
    // would meanwhile ratchet forward 200ms per cached read, and the FIRST request after
    // the burst drained would pay the whole accumulated wait.
    //
    // So the burst is followed by one more read, and the point is that it leaves
    // immediately. Without the rewind the cursor sits at 1800 while the clock is at 180,
    // and this read would depart at 1800.
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [CACHED])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    await Promise.all(Array.from({ length: 9 }, () => scheduler.fetch(URL_A)))
    await scheduler.fetch(URL_A)

    expect(calls.at(-1)).toBe(180)
    expect(clock.now()).toBe(200)
  })
})

describe('a run of real requests', () => {
  it('still leaves at no more than requestsPerSecond', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [NETWORK])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    await runVirtual(clock, Promise.all(Array.from({ length: 10 }, () => scheduler.fetch(URL_A))))

    // The refund must not disarm the cap for calls that DO go out. Exceeding 5 per second
    // collects 429s, and the backoff path then makes everything slower than the spacing
    // this is trying to avoid paying.
    expect(calls).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800])
    expect(busiestSecond(calls)).toBe(5)
  })

  it('keeps two real requests a slot apart when cached reads interleave', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [
      CACHED,
      NETWORK,
      CACHED,
      NETWORK,
      CACHED,
      NETWORK,
    ])
    const scheduler = createScheduler({ clock, fetchImpl, requestsPerSecond: 5 })

    await runVirtual(clock, Promise.all(Array.from({ length: 6 }, () => scheduler.fetch(URL_A))))

    // A refunded slot may be reused by the next caller, but only a cache hit refunds, so
    // the calls that actually reach Airtable stay a full slot apart no matter how many
    // hits went out between them.
    const network = calls.filter((_, index) => index % 2 === 1)
    const gaps = network.slice(1).map((at, index) => at - (network.at(index) ?? 0))
    expect(gaps.every((gap) => gap >= SPACING_MS)).toBe(true)
    expect(busiestSecond(network)).toBeLessThanOrEqual(5)
  })
})

describe('a refused attempt', () => {
  // Backoff is pinned to 50ms (base 100, jitter 0), deliberately shorter than one slot, so
  // the retry's own wait is what these assertions see.
  const refusedConfig = { requestsPerSecond: 5, random: () => 0, baseBackoffMs: 100 }

  it('keeps its slot when a 429 comes back instantly', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [
      { latencyMs: 0, status: 429 },
      { latencyMs: 0, status: 200 },
    ])
    const scheduler = createScheduler({ ...refusedConfig, clock, fetchImpl })

    await runVirtual(clock, scheduler.fetch(URL_A))

    // A 429 is the cap itself talking. Reading its speed as a cache hit would hand the
    // slot back at exactly the moment the limiter is proving necessary, and the retry
    // would then leave at 50ms instead of 200ms.
    expect(calls).toEqual([0, 200])
  })

  it('keeps its slot when a 5xx comes back instantly', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [
      { latencyMs: 0, status: 503 },
      { latencyMs: 0, status: 200 },
    ])
    const scheduler = createScheduler({ ...refusedConfig, clock, fetchImpl })

    await runVirtual(clock, scheduler.fetch(URL_A))

    expect(calls).toEqual([0, 200])
  })

  it('gives the retry no credit for coming back instantly either', async () => {
    const clock = virtualClock()
    const { fetchImpl, calls } = tracedFetch(clock, [
      { latencyMs: 0, status: 429 },
      { latencyMs: 0, status: 200 },
      { latencyMs: 0, status: 200 },
    ])
    const scheduler = createScheduler({ ...refusedConfig, clock, fetchImpl })

    await runVirtual(
      clock,
      (async () => {
        await scheduler.fetch(URL_A)
        await scheduler.fetch(URL_A)
      })(),
    )

    // Each attempt charges its own slot, and an attempt that follows a refused one is
    // never treated as free however fast it answers. If the retry at 200 had been
    // refunded, the next request would have left at 200 as well rather than at 400.
    expect(calls).toEqual([0, 200, 400])
  })
})
