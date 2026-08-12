// The one gate every Airtable request passes through.
//
// Airtable allows roughly 5 requests per second per base, and metadata calls draw
// on the same budget (BUILD_SPEC 3.1). An admin screen that fans out per-row
// lookups crosses that line and starts collecting 429s, so the cap is enforced
// here once rather than remembered at each call site.
//
// Everything the algorithm needs from the outside is a parameter: the clock, the
// sleeper, the jitter source, and `fetch` itself. Nothing below reads the ambient
// clock or touches the network directly, which is what makes the spacing and the
// backoff assertable without real timers (tests/airtable-scheduler.test.ts).
//
// The cap itself lives in rate-window.ts, which is where the interesting problem is:
// Next's cache is inside the call this file wraps, so a slot has to be charged before
// anyone knows whether the answer is coming from R2 or from Airtable. This file's job
// is the retry half, plus reporting each call's outcome back to the window so a read
// that never left the isolate is not charged for the trip.
//
// Scope of the cap: one scheduler per base, memoised in a module-level Map, so on
// Workers the cap is PER ISOLATE. Two isolates serving the same base each get
// their own 5 req/s allowance, and the real ceiling is whatever the platform
// happens to be running. That is accepted deliberately: a globally correct cap
// means a Durable Object hop in front of every read, which would put a network
// round trip on the path this file exists to keep short. Backoff is what covers
// the case where several isolates collectively overshoot.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  type Admission,
  type Clock,
  createRateWindow,
  realClock,
  verdictFor,
} from '@/services/airtable/rate-window'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type { Clock }

export type SchedulerConfig = {
  fetchImpl: FetchLike
  clock: Clock
  /** Jitter source. Injected so a test can pin the delay it asserts on. */
  random: () => number
  /** Requests allowed per second, per base, per isolate. */
  requestsPerSecond: number
  /** Total tries including the first, so 1 means no retry at all. */
  maxAttempts: number
  baseBackoffMs: number
  maxBackoffMs: number
  /**
   * Ceiling on an honoured `Retry-After`. Airtable sends single-digit seconds, but
   * a Worker has a bounded wall-clock budget, so a header asking for a day has to
   * be clamped rather than trusted.
   */
  retryAfterCapMs: number
  /**
   * Called immediately BEFORE each await in `run`, never after. Undefined by default,
   * wired from DIAG_AIRTABLE in `getScheduler`.
   *
   * Before, and not after, because of what it is for. A request that hangs is cancelled
   * by the runtime without ever reaching a line that runs after the await, so anything
   * logged on completion is logged by exactly the requests that did not have the
   * problem. A timer-based watchdog is no better: the leading suspect is that the
   * isolate's timers stopped firing, and a watchdog built on `setTimeout` would be the
   * second casualty rather than the witness. Logging before each await leaves a trail
   * whose LAST entry names the await that never returned.
   */
  onPhase?: (phase: 'admitting' | 'fetching', target: string, attempt: number) => void
}

export type Scheduler = {
  fetch: FetchLike
}

const DEFAULT_CONFIG: SchedulerConfig = {
  fetchImpl: (input, init) => fetch(input, init),
  clock: realClock,
  random: Math.random,
  requestsPerSecond: 5,
  maxAttempts: 5,
  baseBackoffMs: 400,
  maxBackoffMs: 8_000,
  retryAfterCapMs: 30_000,
}

/**
 * The longest one call through this scheduler can take before it gives up.
 *
 * Every attempt after the first waits first, and a `Retry-After` is honoured up to the cap,
 * so the ceiling is the number of waits times that cap. Network time is on top of it, which
 * is why this is a floor for anyone sizing against it rather than a promise.
 *
 * Exported because a caller that holds a LEASE across DAL calls has to size it against the
 * retry policy rather than the happy path, and a number copied into that caller drifts the
 * moment `maxAttempts` or the cap changes here. `PRESCREEN_ENQUEUE_LEASE_MS` is the one
 * caller so far.
 */
export const WORST_CASE_CALL_MS = (DEFAULT_CONFIG.maxAttempts - 1) * DEFAULT_CONFIG.retryAfterCapMs

/** What one try produced: something to hand back, or a reason to try again. */
type Attempt =
  | { kind: 'settled'; response: Response }
  | { kind: 'retryable'; status: number; retryAfterMs?: number }

/**
 * Exponential backoff with jitter, in the low half of the window.
 *
 * Jitter matters here more than the doubling does: several isolates that hit the
 * same 429 at the same moment would otherwise retry in lockstep and reproduce the
 * burst that caused it. The floor of half the window keeps a retry from firing
 * effectively instantly when the jitter source returns 0.
 */
export function computeBackoffMs(
  attempt: number,
  options: { baseBackoffMs: number; maxBackoffMs: number; jitter: number },
): number {
  const window = Math.min(options.maxBackoffMs, options.baseBackoffMs * 2 ** (attempt - 1))
  return Math.round(window * (0.5 + 0.5 * options.jitter))
}

/**
 * `Retry-After` in either of its two legal forms: delay-seconds or an HTTP date.
 * `now` is a parameter for the date form so the caller's clock decides.
 */
export function parseRetryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined
  const trimmed = header.trim()
  if (trimmed === '') return undefined

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

/**
 * A scheduler with its own rate window. Call this directly in tests; production
 * code goes through `getScheduler(baseId)` so one window is shared per base.
 */
export function createScheduler(overrides: Partial<SchedulerConfig> = {}): Scheduler {
  const config: SchedulerConfig = { ...DEFAULT_CONFIG, ...overrides }
  const rateWindow = createRateWindow({
    clock: config.clock,
    spacingMs: Math.ceil(1000 / config.requestsPerSecond),
  })

  async function tryOnce(
    input: string,
    init: RequestInit | undefined,
    slot: { admission: Admission; firstAttempt: boolean },
  ): Promise<Attempt> {
    let response: Response
    const startedAt = config.clock.now()
    try {
      response = await config.fetchImpl(input, init)
    } catch {
      // Transport failure: DNS, TLS, a reset connection. Retryable, and status 0
      // keeps it distinguishable from an HTTP status when we pick the error id.
      // The slot stays spent: a failed connection did reach the network.
      slot.admission.settle('network')
      return { kind: 'retryable', status: 0 }
    }
    const elapsedMs = config.clock.now() - startedAt

    // 429 is the rate cap talking; 5xx is Airtable itself. Every other status,
    // including 422 for a bad request, is an answer and retrying only spends
    // budget on getting the same answer again.
    const retryable = response.status === 429 || response.status >= 500

    // What the window is told, and the two flags that keep it honest: a retryable answer
    // and any attempt after the first are network calls whatever the stopwatch says. See
    // `verdictFor`.
    slot.admission.settle(verdictFor({ elapsedMs, retryable: retryable || !slot.firstAttempt }))

    if (retryable) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('retry-after'),
        config.clock.now(),
      )
      return {
        kind: 'retryable',
        status: response.status,
        retryAfterMs:
          retryAfterMs === undefined ? undefined : Math.min(retryAfterMs, config.retryAfterCapMs),
      }
    }

    return { kind: 'settled', response }
  }

  function delayFor(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return retryAfterMs
    return computeBackoffMs(attempt, {
      baseBackoffMs: config.baseBackoffMs,
      maxBackoffMs: config.maxBackoffMs,
      jitter: config.random(),
    })
  }

  async function run(input: string, init?: RequestInit): Promise<Response> {
    let lastStatus = 0

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      // Every attempt asks for its own slot, so a retry never rides on the one the
      // attempt before it charged.
      config.onPhase?.('admitting', input, attempt)
      const admission = await rateWindow.admit()

      config.onPhase?.('fetching', input, attempt)
      const outcome = await tryOnce(input, init, { admission, firstAttempt: attempt === 1 })
      if (outcome.kind === 'settled') return outcome.response

      lastStatus = outcome.status
      if (attempt === config.maxAttempts) break
      // Backoff is nobody else's business, so this nap's handle is dropped: the only
      // thing that wakes a wait early is a refund, and a refund concerns the rate window.
      await config.clock.sleep(delayFor(attempt, outcome.retryAfterMs)).done
    }

    // Bounded on purpose. A read that keeps retrying holds a request open and
    // makes the page look hung, so the caller gets an error it can render.
    const context = { url: input, attempts: config.maxAttempts, status: lastStatus }
    if (lastStatus === 429) {
      throw new AppError(
        ErrorIds.DATA_RATE_LIMITED,
        'airtable kept returning 429 after every retry',
        context,
      )
    }
    throw new AppError(
      ErrorIds.NET_UNAVAILABLE,
      'airtable did not answer after every retry',
      context,
    )
  }

  return { fetch: run }
}

// One rate window per base. Module-level, so per isolate: see the header comment
// for why that is the accepted trade rather than an oversight.
const schedulers = new Map<string, Scheduler>()

/**
 * `overrides` is read only when the scheduler for `baseId` is first created, which is
 * the point of the memo: one rate window per base. Everything passed today is derived
 * from env and so is the same on every call, but a future override that varies per
 * request would be silently ignored after the first one.
 */
export function getScheduler(baseId: string, overrides: Partial<SchedulerConfig> = {}): Scheduler {
  const existing = schedulers.get(baseId)
  if (existing !== undefined) return existing

  const created = createScheduler(overrides)
  schedulers.set(baseId, created)
  return created
}
