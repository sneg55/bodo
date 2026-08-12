// What a finished Airtable call turned out to be, and the two tuned numbers behind that
// judgement. Split out of rate-window.ts, which owns the queue: this half is a pure
// function over one call's stopwatch, that half is shared mutable state across an isolate.
// They are re-exported from rate-window.ts, so no caller had to change.

/** What a finished call turned out to be. Only a verified cache hit is free. */
export type Verdict = 'cached' | 'network'

/**
 * How far past a sleeper's own deadline the window waits before deciding that sleeper is
 * never going to wake up.
 *
 * This exists because of a deployed outage on 2026-08-09, and the failure is worth stating
 * exactly, because nothing about it is visible from inside the queue. That queue is module
 * scope, so it is shared by every request an isolate is serving, and the caller holding its
 * head is asleep on a `setTimeout` that some OTHER request armed. On Workers a timer does
 * not outlive the request that armed it: when that request ends, the timer is cancelled,
 * `nap.done` never resolves, and `take` never returns. `admit` chains the queue on exactly
 * that promise, so from then on EVERY Airtable read in the isolate waits on a promise that
 * cannot settle. The isolate keeps serving requests and every one of them hangs until the
 * runtime cancels it.
 *
 * That is what it looked like in the tail: `/admin/{eventId}` answering `outcome: canceled`
 * after 215s to 337s at 9ms to 43ms of CPU, six `admitting` log lines and no `fetching`
 * line, and five of them terminating at the same instant when the isolate was finally
 * recycled. The trigger was a read that threw out of a `Promise.all` on the evaluation
 * page, which ended its request while three sibling reads were still parked in `take`.
 *
 * A live sleeper is late by a millisecond or two, so anything past a full second is not
 * lateness. The two ways of being wrong are not symmetric either: repairing a sleeper that
 * was merely slow lets one extra request depart early, which Airtable answers with a 429
 * and the scheduler answers with backoff, while failing to repair a dead one costs every
 * read the isolate has left to serve.
 */
export const STALL_GRACE_MS = 1_000

/**
 * Above this, a call is assumed to have crossed the network and keeps its slot.
 *
 * MEASURED on the deployed Worker rather than guessed, because the first guess (20ms) was
 * wrong in a way that quietly halved the benefit. Instrumenting the scheduler and tailing
 * two requests to the abstracts page gave 32 samples in two clearly separated populations:
 *
 *   3, 3, 3, 3, 3, 4, 4, 21, 23, 28, 28, 30, 32, 45   <- 14 cache reads
 *   115 ... 712                                        <- 18 Airtable round trips
 *
 * The gap runs from 45ms to 115ms, so 60 sits in the middle of empty space. At 20 the seven
 * reads between 21ms and 45ms were charged a slot despite never leaving the isolate, which
 * is the cost this exists to remove.
 *
 * Recalibrate by repeating that measurement if the cache backend changes, since the lower
 * population is an R2 read through the regional cache and the upper one is Airtable from a
 * Worker. Being wrong low just leaves latency on the table, which is what happened here.
 *
 * Being wrong HIGH is the real limitation, and it is worth stating exactly rather than
 * softening. A genuine non-retryable response (a 200, a 3xx, a non-429 4xx) that answers in
 * 60ms or less is indistinguishable from a cache hit here and refunds its slot, so the cap
 * is conditional rather than absolute: Codex review reproduced 17 departures in one second
 * at exactly 60ms elapsed, and an arbitrarily large cohort answering in 0ms could leave in
 * one tick. That did not happen in the sample above, where the fastest round trip was 115ms,
 * but it is not prevented.
 *
 * It is not prevented because it CANNOT be, in this position: Next patches the global fetch,
 * so the Data Cache is inside the call being timed and elapsed time is the only signal there
 * is. A hard rolling-window count of departures does not help, because it would have to
 * decide which departures to count using the same signal.
 *
 * What makes the residual risk acceptable is that overshooting is self-limiting rather than
 * runaway. Exceeding the cap gets 429s, `verdictFor` classifies every 429 as network however
 * fast it returns, so those slots are never handed back, and the retry then waits out its
 * backoff on top. The limiter tightens on exactly the evidence that it was too loose.
 */
export const CACHE_HIT_CEILING_MS = 60

/**
 * Elapsed time is the only signal available: Next puts no "this was a cache hit" marker on
 * the Response, and the cache is inside the call being timed.
 */
export function verdictFor(options: { elapsedMs: number; retryable: boolean }): Verdict {
  // A 429 is the rate cap itself talking and a 5xx is Airtable struggling, and both can
  // come back in single-digit milliseconds. Reading either as a cache hit would loosen the
  // limiter at exactly the moment it is proving necessary, which is backwards. The same
  // flag covers a retry: an attempt following a refused one is never free, however fast it
  // answers, because the thing that refused it has not gone anywhere.
  if (options.retryable) return 'network'
  return options.elapsedMs > CACHE_HIT_CEILING_MS ? 'network' : 'cached'
}
