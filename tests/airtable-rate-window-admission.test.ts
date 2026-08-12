// The admission half of the rate window, driven directly rather than through a scheduler.
//
// Split out of tests/airtable-rate-window.test.ts, which covers the same window from the
// outside: what a burst of reads costs, and how far apart real requests leave. These are
// the ones that reach past that and poke `admit` and `settle` by hand, because a refund
// interrupting somebody else's wait is not visible in call timings alone.
//
// The clock is virtual and its sleeps resolve only when the test fires them, which is what
// lets a wait be observed losing a race. See tests/helpers/virtual-clock.ts.

import { describe, expect, it } from 'vitest'

import { createRateWindow } from '@/services/airtable/rate-window'

import { flush, runVirtual, virtualClock } from './helpers/virtual-clock'

/** 5 requests per second is a 200ms slot. */
const SPACING_MS = 200
const CACHED_MS = 20

describe('createRateWindow', () => {
  const CACHE_HIT = 'cached'

  it('cuts a waiting caller loose as soon as a cached call hands its slot back', async () => {
    const clock = virtualClock()
    const window = createRateWindow({ clock, spacingMs: SPACING_MS })

    const first = await window.admit()
    const second = window.admit()
    await flush()
    // Waiting out the slot the first call charged, which is all it can do until it hears
    // something. This is the wait a refund has to be able to interrupt: a caller that
    // committed to 200ms of sleep is why nine concurrent cache hits used to cost 1600ms.
    expect(clock.waiting()).toBe(1)

    clock.advance(CACHED_MS)
    first.settle(CACHE_HIT)
    await second

    expect(clock.now()).toBe(CACHED_MS)
    expect(clock.waiting()).toBe(0)
  })

  it('ignores a refund from a call that is no longer the last to have charged', async () => {
    const clock = virtualClock()
    const window = createRateWindow({ clock, spacingMs: SPACING_MS })

    const first = await window.admit()
    const second = await runVirtual(clock, window.admit())
    expect(clock.now()).toBe(SPACING_MS)

    // Too late: the second caller has charged since, so handing this slot back would put
    // the cursor behind a reservation somebody else is already holding.
    first.settle(CACHE_HIT)
    await runVirtual(clock, window.admit())
    expect(clock.now()).toBe(2 * SPACING_MS)

    second.settle('network')
  })

  it('does not wake a sleeper on a refund the guard rejects', async () => {
    // The test above settles the stale admission while nobody is asleep, so it pins the
    // cursor guard but not the wake. An implementation that woke the sleeper BEFORE
    // checking the guard would pass it and still be wrong here: the third caller is asleep
    // on a slot the second caller legitimately charged, and a refund from the first caller
    // must not cut that short.
    const clock = virtualClock()
    const window = createRateWindow({ clock, spacingMs: SPACING_MS })

    const first = await window.admit()
    const second = await runVirtual(clock, window.admit())
    const third = window.admit()
    await flush()
    expect(clock.waiting()).toBe(1)

    first.settle(CACHE_HIT)
    await flush()

    // Still asleep, because that refund was not the last charge and buys nobody anything.
    expect(clock.waiting()).toBe(1)
    expect(clock.now()).toBe(SPACING_MS)

    second.settle('network')
    await runVirtual(clock, third)
    expect(clock.now()).toBe(2 * SPACING_MS)
  })

  it('survives a wake that throws instead of pinning the sleeper on it', async () => {
    // The deployed failure this pins. The window is module scope, so it is shared by every
    // request an isolate is serving, and waking a sleeper used to mean calling `abort()` on
    // an AbortController that some OTHER request had created. workerd refuses that:
    //
    //   Cannot perform I/O on behalf of a different request ... (I/O type: RefcountedCanceler)
    //
    // It arrived as a 500 out of `settle`, through listMembershipsForUser and eventRoleOf,
    // so through every admin page. The lasting damage was the ordering: `refund` woke first
    // and cleared `sleeper` second, so the throw left the field pointing at a handle from a
    // request that was already gone, and every later refund in that isolate threw on the
    // same one. One bad wake broke every cached read the isolate went on to serve.
    //
    // `wake` is a plain callback now and cannot throw for that reason. This asserts the
    // ordering anyway, because the ordering is what turned one error into a broken isolate.
    const clock = virtualClock()
    const hostile: typeof clock = {
      ...clock,
      sleep: (ms) => ({
        done: clock.sleep(ms).done,
        wake: () => {
          throw new Error('Cannot perform I/O on behalf of a different request')
        },
      }),
    }
    const window = createRateWindow({ clock: hostile, spacingMs: SPACING_MS })

    const first = await window.admit()
    const second = window.admit()
    await flush()
    expect(clock.waiting()).toBe(1)

    expect(() => {
      first.settle(CACHE_HIT)
    }).toThrow(/different request/)

    // The refund still landed: the cursor rewound even though waking the sleeper did not.
    // And the next refund finds no sleeper to wake, so it goes through cleanly rather than
    // throwing on the same dead handle.
    const third = await runVirtual(clock, second)
    expect(() => {
      third.settle(CACHE_HIT)
    }).not.toThrow()
  })
})

describe('a caller that dies holding the head of the queue', () => {
  // The 2026-08-09 outage, which is the reason `releaseStalledHead` exists.
  //
  // The window is module scope, so the caller asleep on the head of the queue belongs to
  // some OTHER request, and on Workers a `setTimeout` does not outlive the request that
  // armed it. When that request ended, the timer went with it, `nap.done` could never
  // resolve, and `admit` had chained `queue` on exactly that promise. Every Airtable read
  // the isolate served afterwards waited on a promise that could not settle: in the tail,
  // `/admin/{eventId}` answering `outcome: canceled` after 215s to 337s at ~10ms of CPU,
  // with six `admitting` lines and no `fetching` line, five of them ending at the same
  // instant when the isolate was finally recycled.
  //
  // `abandonEarliest` is that cancellation: the sleep is dropped without being resolved,
  // so firing the clock does nothing for it for the rest of the test.

  const GRACE_MS = 500

  it('lets a later caller through instead of queueing behind it for ever', async () => {
    const clock = virtualClock()
    const window = createRateWindow({ clock, spacingMs: SPACING_MS, stallGraceMs: GRACE_MS })

    await window.admit()
    // Becomes the head and sleeps out the slot the first caller charged.
    const abandoned = window.admit()
    await flush()
    expect(clock.waiting()).toBe(1)

    // Its request ends here.
    expect(clock.abandonEarliest()).toBe(true)
    clock.advance(SPACING_MS + GRACE_MS)

    // Nothing can wake the head on its own now, so this is the assertion that would have
    // hung for ever before: a caller arriving afterwards still gets admitted.
    const rescued = await runVirtual(clock, window.admit())
    expect(rescued).toBeDefined()

    // And the corpse was released rather than left pinned as the sleeper, so the window is
    // usable again rather than merely unblocked once.
    await expect(runVirtual(clock, abandoned)).resolves.toBeDefined()
    await expect(runVirtual(clock, window.admit())).resolves.toBeDefined()
  })

  it('drops the chain when waking the corpse does not bring it back', async () => {
    // The half of the outage `releaseStalledHead` does NOT cover, measured on the deployed
    // Worker on 2026-08-10: `/agenda/{slug}` answering `outcome: canceled` at 35.7s wall and
    // 10ms CPU with two `admitting` lines and no `fetching` line, while `/login`, which
    // reads no Airtable, answered in 135ms throughout. One isolate stayed wedged 22 minutes.
    //
    // Waking a dead sleeper resolves its promise, but a dead request does not RUN the
    // continuation waiting on it, so the head never reaches its decision and `queue` stays
    // chained on a promise nothing can settle. `releaseStalledHead` has already cleared
    // `sleeper` by then, so from the outside the queue is stuck with nobody asleep -- which
    // is exactly the state `abandonStalledQueue` looks for.
    //
    // `inertSleep` is that dead request: the nap is dropped from the clock AND its `wake` is
    // a no-op, so nothing in the test can make its promise settle. That is stronger than
    // `abandonEarliest`, which leaves a handle the window can still resolve.
    const clock = virtualClock()
    const inert = { done: new Promise<void>(() => undefined), wake: () => undefined }
    let inertUsed = false
    const dyingClock = {
      ...clock,
      sleep: (ms: number) => {
        if (inertUsed) return clock.sleep(ms)
        inertUsed = true
        return inert
      },
    }
    const window = createRateWindow({
      clock: dyingClock,
      spacingMs: SPACING_MS,
      stallGraceMs: GRACE_MS,
    })

    await window.admit()
    // Takes the head and sleeps on the slot the first caller charged. Its nap can never
    // resolve, and its request is gone, so its decision never arrives.
    void window.admit()
    await flush()

    // Long enough that the head is past its deadline and the queue has not moved.
    clock.advance(SPACING_MS + GRACE_MS + 1)

    // Before the repair this hung for ever: no sleeper to release, so `waitForTurn` fell
    // through to an unbounded await on the dead head's promise.
    await expect(runVirtual(clock, window.admit())).resolves.toBeDefined()
    // And the window keeps working rather than being unblocked exactly once.
    await expect(runVirtual(clock, window.admit())).resolves.toBeDefined()
  })

  it('releases it on its own watch when no further caller arrives to do it', async () => {
    // The case above is repaired by new traffic reaching `admit`. This one has no new
    // traffic: the caller that is already queued behind the dead head has to notice by
    // itself, on a timer it armed in its OWN request, which is the only kind it can trust.
    const clock = virtualClock()
    const window = createRateWindow({ clock, spacingMs: SPACING_MS, stallGraceMs: GRACE_MS })

    await window.admit()
    const abandoned = window.admit()
    await flush()

    // Queued behind the head while the head is still legitimately asleep, so this caller
    // arms its watch before there is anything wrong to see.
    const waiting = window.admit()
    await flush()

    // The head's timer dies; the watcher's does not. `abandonEarliest` takes the head's
    // because it is due at 200 and the watch is due at 700.
    expect(clock.abandonEarliest()).toBe(true)

    await expect(runVirtual(clock, waiting)).resolves.toBeDefined()
    await expect(runVirtual(clock, abandoned)).resolves.toBeDefined()
  })
})
