// How long one model call is allowed to take, and what that makes the worst case.
//
// **A leaf on purpose: nothing here imports `@anthropic-ai/sdk`.** `client.ts` imports
// these constants, never the other way round, so anything that only needs to SIZE
// something against a model call can have the number without the 462 KB of SDK that
// `notice.ts` has the story about. That is not hypothetical here: `PRESCREEN_LEASE_MS` is
// derived from `AI_WORST_CASE_CALL_MS`, and the module it lives in is imported by a
// `'use client'` panel.
//
// The numbers exist because the SDK's defaults are wrong for this tree in the one
// direction that costs money. Left alone, a request waits ten minutes and is retried
// twice, so a single `complete()` can run for well over half an hour, which is longer than
// any lease a caller would think to write and longer than the interval between cron ticks.

/**
 * The per-request ceiling handed to the SDK, against a default of ten minutes.
 *
 * Sixty seconds, and sized off what this tree actually sends rather than off what the API
 * permits: all three callers use `effort: 'low'` with a `max_tokens` budget in the low
 * thousands covering thinking and answer together, which is a call that answers in
 * seconds. A minute is an order of magnitude of headroom over that, so it expires when
 * the API has stopped answering rather than when it is merely slow.
 *
 * It is a background scoring call that sets the number, because that is the caller that
 * holds a lease across it. The two interactive callers (`ask`, the dashboard proposal)
 * send the same low-effort shape and a person is waiting on them, so a shorter bound
 * would suit them too; nothing here is longer than they would want.
 */
export const AI_REQUEST_TIMEOUT_MS = 60_000

/**
 * Retries inside one call, against an SDK default of 2.
 *
 * One, because the pre-screen already retries: a job gets `PRESCREEN_MAX_ATTEMPTS` goes at
 * the model, so SDK-level retries MULTIPLY with queue-level ones and three attempts of
 * three is nine paid calls for one abstract. One covers the blip that is genuinely worth
 * riding out inside a single tick (a 5xx, a dropped connection) and leaves the rest to the
 * queue, which is the layer that can record what happened on the row.
 */
export const AI_MAX_RETRIES = 1

/**
 * The SDK's own ceiling on the sleep between retries, read off its retry policy
 * (`node_modules/@anthropic-ai/sdk/client.js`, `calculateDefaultRetryTimeoutMillis`:
 * 0.5s doubling, capped at 8s, times a jitter factor below 1).
 *
 * Restated here because the worst case below has to include the waiting, and there is no
 * export to import it from. It is a ceiling the SDK will not exceed, not a guess.
 */
export const AI_RETRY_BACKOFF_CEILING_MS = 8_000

/**
 * The longest one `complete()` can run before it throws.
 *
 * Every attempt gets the full timeout and every retry sleeps first, so the bound is the
 * attempts times the timeout plus the sleeps between them. Network setup is on top of it,
 * which makes this a floor for anyone sizing a LEASE against it rather than a promise:
 * size with headroom, not exactly.
 *
 * Exported for exactly one reason, and it is the reason `WORST_CASE_CALL_MS` is exported
 * from the Airtable scheduler: a caller holding a claim across a model call has to size it
 * against the retry policy, and a number copied into that caller drifts the moment the
 * timeout or the retry count changes here.
 */
export const AI_WORST_CASE_CALL_MS =
  (AI_MAX_RETRIES + 1) * AI_REQUEST_TIMEOUT_MS + AI_MAX_RETRIES * AI_RETRY_BACKOFF_CEILING_MS
