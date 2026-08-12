// Who may talk to Airtable, and when. Extracted from scheduler.ts so the algorithm can be
// exercised on its own, which is the point of injecting the clock in the first place.
//
// Airtable allows roughly 5 requests per second per base and metadata calls draw on the
// same budget (BUILD_SPEC 3.1), so the cap is enforced around `fetch`, the one place every
// read passes through. The awkward part is that Next patches the GLOBAL `fetch`, so its
// Data Cache sits INSIDE the call this file wraps: at the moment a call asks permission,
// nothing knows whether the answer will come from R2 or from Airtable. Measured on the
// deployed Worker, a fully cached admin page made 16 reads, every one a cache hit, and
// paid the full 200ms spacing on every one of them.
//
// So permission is PROVISIONAL. A call is charged a slot when it leaves and hands the slot
// back if it returns too fast to have crossed the network (`verdictFor`). Two things follow
// and they are what the code below is for:
//
//   - Admission is FIFO, one decision at a time. The first version handed every concurrent
//     caller its own slot up front (0, 200, 400, ...), which is exactly why a refund could
//     not help anybody: the nine reads in `loadAbstractsView`'s Promise.all had all
//     reserved before the first answer came back, so the refunds landed too late and the
//     page paid 1.6s of pure waiting even fully cached. With one decision at a time nobody
//     holds a slot somebody else is sleeping on, which is also what makes a refund safe.
//   - A waiting caller can be woken. A refund is worth nothing to a caller that has already
//     committed to sleeping 200ms, so the wait is an abortable sleep and the refund aborts
//     it. That is the whole mechanism: nine cached reads cost nine cache reads (3ms to 45ms
//     each, measured) instead of nine slots.
//
// What is deliberately NOT done: dispatching a burst concurrently on the strength of a hit
// rate observed earlier. An estimator (an exponentially-weighted miss rate, a token bucket
// with burst) buys that concurrency by sending N calls with no evidence, and N is then
// exactly how far past the cap a burst goes when the cache has just gone stale. Airtable
// answers that with 429 and a documented cool-off measured in tens of seconds, which is
// far worse than the 200ms being saved and turns a slow page into a broken one. The reads
// on one admin page share two revalidate windows (read-cache.ts), so they go stale in
// cohorts and that transition is routine rather than a corner case. Evidence, then speed.

import type { Clock, Nap } from '@/services/airtable/clock'
import { STALL_GRACE_MS, type Verdict } from '@/services/airtable/rate-verdict'

export type { Clock, Nap } from '@/services/airtable/clock'
export { realClock } from '@/services/airtable/clock'

export type { Verdict } from '@/services/airtable/rate-verdict'
export {
  CACHE_HIT_CEILING_MS,
  STALL_GRACE_MS,
  verdictFor,
} from '@/services/airtable/rate-verdict'

export type Admission = {
  /** Report the outcome. Later calls are ignored, so one call cannot pay twice. */
  settle: (verdict: Verdict) => void
}

export type RateWindow = {
  /** Resolves when the caller may issue its request, having charged it a slot. */
  admit: () => Promise<Admission>
}

export function createRateWindow(options: {
  clock: Clock
  spacingMs: number
  /** Defaults to `STALL_GRACE_MS`; a parameter so a test can drive it without real time. */
  stallGraceMs?: number
}): RateWindow {
  const { clock, spacingMs } = options
  const stallGraceMs = options.stallGraceMs ?? STALL_GRACE_MS

  // The earliest instant a request may leave. Only ever moved by the caller currently being
  // admitted, or by that caller's own refund, which is what the FIFO queue below buys.
  let nextSlotAt = 0
  // The queue, as a promise chain: caller k decides only after caller k-1 has decided.
  let queue: Promise<unknown> = Promise.resolve()
  // Set while somebody is asleep on a slot, so a refund can wake them. Belongs to whichever
  // request is currently asleep, which is why it is a `Nap` and not an AbortController.
  let sleeper: Nap | undefined
  // When `sleeper` is due to wake. The only way to tell a sleeper that is merely waiting
  // from one whose timer died with its request: see STALL_GRACE_MS.
  let sleeperDueAt: number | undefined
  // How many callers are between `admit` and their decision. Read BEFORE the caller adds
  // itself, so it answers "is anyone ahead of me", which is the only case that needs
  // watching: a caller with nobody ahead of it is about to become the head, and the head
  // waits on a timer it armed itself.
  //
  // Never decremented for a caller whose request died, which is the point: the count stays
  // raised, so everyone arriving afterwards watches the queue instead of trusting it.
  let queued = 0
  // When the queue last MOVED: a caller reached its decision, or a stalled chain was
  // abandoned. This is the only signal that separates a head which is briefly awake between
  // naps from one whose request has ended, since neither registers a sleeper. See
  // `waitForTurn`.
  let advancedAt = clock.now()

  /**
   * Release a sleeper that is past its deadline by more than the grace period.
   *
   * Safe to call from any request, and that is the whole reason it works: resolving a
   * promise is not I/O, so a live request may finish a dead one's wait. The corpse then
   * resumes, does the arithmetic in `take`, and its own `fetch` throws
   * `Cannot perform I/O on behalf of a different request` -- which is fine and expected,
   * because `admit` routes the queue through a catch, so a throw advances the queue just
   * as well as a return does.
   */
  function releaseStalledHead(): void {
    if (sleeper === undefined || sleeperDueAt === undefined) return
    if (clock.now() < sleeperDueAt + stallGraceMs) return
    const stalled = sleeper
    sleeper = undefined
    sleeperDueAt = undefined
    stalled.wake()
  }

  /**
   * Drop a queue whose head left no sleeper to release, and the other half of the 2026-08-09
   * repair.
   *
   * `releaseStalledHead` can only rescue a head that is ASLEEP: it wakes the nap and the
   * corpse resumes. A head whose request ended while it held the turn but was not sleeping
   * leaves nothing to wake. Its `admitted` promise simply never settles -- a dead request's
   * microtasks do not run, so the `.then(take)` continuation never fires -- and `admit`
   * chained `queue` on exactly that promise. Every later caller in the isolate then waits on
   * a promise that nothing can settle, which is unbounded: `waitForTurn` finds no sleeper to
   * watch and falls through to a bare `await settled`.
   *
   * Measured on the deployed Worker on 2026-08-10 while ten browser agents drove the app:
   * `/agenda/{slug}` and `/submit/...` answering `outcome: canceled` at 35.7s wall and 10ms
   * CPU, two `admitting` log lines and no `fetching` line, while `/login`, which reads no
   * Airtable, answered in 135ms throughout. One isolate was wedged for 22 minutes.
   *
   * The repair is to abandon the chain rather than inherit it, so the next caller starts
   * clean. Two things make that safe to do from whichever request happens to arrive:
   *
   *   - It is not I/O. Reassigning a variable is something a live request may do on a dead
   *     one's behalf, exactly as `releaseStalledHead` resolves a dead one's promise.
   *   - Being wrong is cheap and self-correcting. A queue that is merely slow gets one extra
   *     departure inside a slot; Airtable answers an overshoot with a 429, `verdictFor`
   *     refuses to refund it, and the scheduler backs off. Being wrong the other way costs
   *     every read the isolate has left to serve.
   *
   * `queued` is deliberately NOT reset. It stays raised, so later arrivals keep watching the
   * queue rather than trusting it, which is the same conservative direction the counter is
   * documented to lean.
   */
  function abandonStalledQueue(): void {
    // A head that is asleep is somebody else's problem: `releaseStalledHead` owns that case
    // and has already run. Nobody queued means there is no chain to be stuck behind.
    if (sleeper !== undefined || queued === 0) return
    if (clock.now() < advancedAt + spacingMs + stallGraceMs) return
    queue = Promise.resolve()
    advancedAt = clock.now()
  }

  /**
   * Wait for `turn`, checking on the head while we do.
   *
   * Every timer armed here belongs to the request doing the waiting: the first is armed in
   * `admit`, which runs synchronously inside the caller, and each later one is armed from
   * the continuation of a tick this same caller armed. A timer belonging to a request that
   * has already ended is precisely what cannot be depended on, so none is depended on.
   *
   * Only callers that arrived behind somebody bother. A caller with an empty queue in front
   * of it is about to be the head, and a head waits on its own timer. `watch` is false only
   * when `queued` was 0, and that means every earlier caller already decided, so the turn
   * being waited on has already settled.
   *
   * The wait is BOUNDED even with nobody asleep, which is the second half of the 2026-08-09
   * repair and the half that was missing. `releaseStalledHead` can only rescue a head that
   * registered a nap. A head whose request ends between taking its turn and reaching that
   * line -- or simply before the `.then(take)` continuation runs, since a dead request's
   * microtasks do not run either -- leaves `admitted` pending with NO sleeper to find, so
   * the old `while (sleeperDueAt !== undefined)` fell straight through to an unbounded
   * `await settled` and the isolate hung on every Airtable read it had left to serve.
   * Measured on the deployed Worker on 2026-08-10: `outcome: canceled` at 35.7s wall and
   * 10ms CPU, two `admitting` lines and no `fetching` line.
   */
  async function waitForTurn(turn: Promise<unknown>, watch: boolean): Promise<void> {
    const settled = turn.then(
      () => 'turn' as const,
      () => 'turn' as const,
    )
    while (watch && sleeperDueAt !== undefined) {
      // Long enough that a healthy sleeper always beats it, so the common path arms one
      // timer, loses the race to `turn`, and never looks at the queue at all.
      const tick = clock.sleep(Math.max(0, sleeperDueAt - clock.now()) + stallGraceMs)
      const won = await Promise.race([settled, tick.done.then(() => 'tick' as const)])
      tick.wake()
      if (won === 'turn') return
      releaseStalledHead()
    }
    await settled
  }

  function refund(charged: number, slotAt: number): void {
    // Skipped when somebody has charged since. That cannot happen while a cached answer is
    // faster than one slot, and the guard costs nothing if a slot is ever configured
    // shorter than the cache-hit ceiling.
    if (nextSlotAt !== charged) return
    nextSlotAt = slotAt
    // Cleared BEFORE it is woken, not after. The version that woke first and cleared second
    // left `sleeper` pinned to the old handle whenever waking threw, and waking used to be
    // able to throw: every later refund in that isolate then threw on the same dead handle,
    // so one bad wake broke every cached read the isolate served afterwards. Waking cannot
    // throw any more, and this ordering means it would not matter if it could.
    const waiting = sleeper
    sleeper = undefined
    sleeperDueAt = undefined
    waiting?.wake()
  }

  async function take(): Promise<Admission> {
    const waitMs = nextSlotAt - clock.now()
    if (waitMs > 0) {
      // Registered in the same synchronous step as the wait it belongs to, so a refund
      // cannot land in between and be lost. `sleeperDueAt` rides along so a caller behind
      // this one can tell a wait from a death.
      const nap = clock.sleep(waitMs)
      sleeper = nap
      sleeperDueAt = clock.now() + waitMs
      await nap.done
      sleeper = undefined
      sleeperDueAt = undefined
    }
    // Recomputed after the wait, because a refund may have moved the slot into the past.
    // Charging from the SLOT and not from `now` is deliberate: a sleep can overshoot, and
    // the cap is about how far apart requests leave rather than how late they are.
    const slotAt = Math.max(clock.now(), nextSlotAt)
    const charged = slotAt + spacingMs
    nextSlotAt = charged

    let settled = false
    return {
      settle: (verdict) => {
        if (settled) return
        settled = true
        if (verdict === 'cached') refund(charged, slotAt)
      },
    }
  }

  function admit(): Promise<Admission> {
    // Everything down to the first `await` runs synchronously inside the calling request,
    // which is what makes the timer `waitForTurn` arms belong to a request that is alive.
    //
    // The free checks first: a caller arriving long after the head died sees an overdue
    // sleeper immediately and needs no timer at all to release it, and a chain whose head
    // left no sleeper at all is dropped rather than joined.
    releaseStalledHead()
    abandonStalledQueue()

    const ahead = queued
    queued += 1

    const turn = queue
    const admitted = waitForTurn(turn, ahead > 0).then(take)
    // The queue advances when the decision is made, not when the request comes back, so a
    // slow round trip never holds the next caller past its own slot. Both arms are absorbed
    // deliberately: a caller released by `releaseStalledHead` throws when its dead request
    // touches I/O, and that throw has to advance the queue rather than break it.
    queue = admitted.then(
      () => {
        queued -= 1
        advancedAt = clock.now()
      },
      () => {
        queued -= 1
        advancedAt = clock.now()
      },
    )
    return admitted
  }

  return { admit }
}
