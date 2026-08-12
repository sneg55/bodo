// A clock whose sleeps resolve only when a test fires them, plus the harness for driving
// work that sleeps on it. Not a test file (vitest only collects `tests/**/*.test.ts`).
//
// The distinction that makes this worth having: a clock whose `sleep` resolves inline
// cannot show whether something cut a wait short, because the sleep always wins the moment
// it is asked for. Here a call that returns without sleeping leaves `now` exactly where it
// was, which is what a cache hit does, and a test that must NOT need a timer to fire can
// prove it by awaiting the work without firing one.

import type { Clock } from '@/services/airtable/rate-window'

export type VirtualClock = Clock & {
  /** Move `now` without resolving a sleep: what a round trip costs. */
  advance: (ms: number) => void
  /** How many callers are asleep right now. */
  waiting: () => number
  /** Jump to the earliest deadline and wake everything due. */
  fire: () => void
  /**
   * Drop the earliest pending sleep WITHOUT resolving it, and report whether there was
   * one. This is a timer cancelled with the request that armed it, which is what Workers
   * does when an invocation ends: the promise stays pending for ever, and no amount of
   * `fire()` will settle it. Only something still alive calling `wake` can.
   */
  abandonEarliest: () => boolean
}

export function virtualClock(): VirtualClock {
  let now = 0
  const asleep = new Set<{ at: number; wake: () => void }>()
  return {
    now: () => now,
    sleep: (ms) => {
      let resolve: () => void = () => undefined
      const done = new Promise<void>((r) => {
        resolve = r
      })
      const waiter = { at: now + ms, wake: resolve }
      asleep.add(waiter)
      return {
        done,
        // Waking removes the waiter, so `waiting()` still counts only live sleeps and a
        // woken caller is not fired a second time by `fire()`.
        wake: () => {
          asleep.delete(waiter)
          resolve()
        },
      }
    },
    advance: (ms) => {
      now += ms
    },
    waiting: () => asleep.size,
    abandonEarliest: () => {
      let doomed: { at: number; wake: () => void } | undefined
      for (const waiter of asleep) {
        if (doomed === undefined || waiter.at < doomed.at) doomed = waiter
      }
      if (doomed === undefined) return false
      // Removed but never resolved: the handle the window still holds is now inert.
      asleep.delete(doomed)
      return true
    },
    fire: () => {
      let earliest = Number.POSITIVE_INFINITY
      for (const waiter of asleep) earliest = Math.min(earliest, waiter.at)
      if (!Number.isFinite(earliest)) return
      now = Math.max(now, earliest)
      for (const waiter of [...asleep]) {
        if (waiter.at <= now) {
          asleep.delete(waiter)
          waiter.wake()
        }
      }
    },
  }
}

/**
 * Lets queued microtasks run, so work that is about to sleep has done so.
 *
 * The turn count has to be generous, and that is a fidelity point rather than a tuning knob.
 * A real runtime drains the WHOLE microtask queue before any timer fires, so a promise chain
 * that resolves without sleeping always beats a pending `setTimeout` no matter how long the
 * chain is. Draining only a few turns here breaks that ordering: `runVirtual` sees work
 * still pending, jumps the clock to the earliest deadline, and a timer wins a race it could
 * never win in production. That is not hypothetical -- at 8 turns, ten queued callers made
 * the departure timeline read 0, 1200, 1400 instead of 0, 200, 400, purely because the
 * fallback timers each caller arms had not lost their race yet.
 */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 200; turn += 1) await Promise.resolve()
}

/**
 * Runs `work` on a virtual clock: drains microtasks, and when the only thing left is a
 * sleep, jumps to its deadline. Nothing real is timed, so this cannot hide a wait.
 */
export async function runVirtual<T>(clock: VirtualClock, work: Promise<T>): Promise<T> {
  // An object rather than a `let`, so the flag reads as a boolean here instead of being
  // narrowed to the literal it was initialised with.
  const state: { running: boolean } = { running: true }
  const tracked = work.finally(() => {
    state.running = false
  })
  for (let round = 0; round < 500 && state.running; round += 1) {
    await flush()
    if (clock.waiting() > 0) clock.fire()
  }
  return await tracked
}

export type Trip = { readonly latencyMs: number; readonly status: number }

/** Replays trips in call order, recording the instant each request left. */
export function tracedFetch(clock: VirtualClock, trips: readonly Trip[]) {
  const calls: number[] = []
  const fetchImpl = (): Promise<Response> => {
    const trip = trips.at(calls.length) ?? trips.at(-1) ?? { latencyMs: 0, status: 200 }
    calls.push(clock.now())
    clock.advance(trip.latencyMs)
    return Promise.resolve(new Response('{}', { status: trip.status }))
  }
  return { fetchImpl, calls }
}

/** The most requests any one-second window contains. */
export function busiestSecond(calls: readonly number[]): number {
  const counts = calls.map((at) => calls.filter((other) => other >= at && other < at + 1000).length)
  return Math.max(...counts)
}
