// The three responses `/api/v1` can produce, in one place so they cannot drift apart.
//
// A public API's error shape is part of its contract as much as its success shape is: a
// client writes `if (body.error)` once and expects it to keep working. So every failure here
// carries the same `{ error: { id, message } }`, with `id` drawn from the project's error
// registry rather than invented per route.
//
// **`Cache-Control: private, no-store` on every response**, and it is deliberate rather than
// cautious. These bodies are authorized per token, so a shared cache that keyed on the URL
// alone would serve one organizer's events to another's token. The speed of the API comes
// from the tagged Airtable reads underneath, which are already warm from the admin screens,
// not from letting an intermediary keep the answer.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import type { Page } from '@/features/api/pagination'

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
} as const

export function jsonPage<T>(page: Page<T>): Response {
  return new Response(JSON.stringify(page), { status: 200, headers: HEADERS })
}

export function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: HEADERS })
}

/**
 * The single refusal for anything that did not authenticate.
 *
 * One body for a missing header, an unknown token, a revoked token and an owner with no
 * memberships, because those are four facts to us and one fact to the client. The
 * `WWW-Authenticate` header is what RFC 7235 requires of a 401 and what makes a generic HTTP
 * client prompt for a credential instead of reporting a bare failure.
 */
export function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      error: { id: ErrorIds.AUTH_NO_SESSION, message: 'invalid or missing token' },
    }),
    { status: 401, headers: { ...HEADERS, 'www-authenticate': 'Bearer realm="bodo"' } },
  )
}

/**
 * An event this token cannot see, or one that does not exist.
 *
 * Both are 404, and that is a decision rather than laziness. A 403 for "exists but not
 * yours" tells an unauthorized caller which slugs are real, which is exactly the enumeration
 * an events API would otherwise hand out for free.
 */
export function notFound(message: string): Response {
  return new Response(JSON.stringify({ error: { id: ErrorIds.DATA_RECORD_NOT_FOUND, message } }), {
    status: 404,
    headers: HEADERS,
  })
}

/**
 * Every `/api/v1` handler runs inside this, and it exists because of a measured failure.
 *
 * An uncaught throw out of a Route Handler is rendered by Next as its own error response,
 * which is HTML. A client that has parsed JSON from every previous response then fails on
 * `JSON.parse` and reports something unrelated to what actually went wrong. Reproduced
 * against a running server: with `ApiTokens` absent from the base, the Airtable read raised
 * `E_NET_006` and `GET /api/v1/events` answered 500 with an HTML body.
 *
 * **A JSON API must answer JSON on its worst day**, so the envelope is the same shape here as
 * on every success and every refusal.
 *
 * The `id` is passed through when it is an `AppError`, because those ids are the project's own
 * registry and a caller quoting `E_NET_006` in a bug report is worth more than a generic
 * string. The MESSAGE is not passed through: it can name a table, a record id, or an Airtable
 * response body, none of which belong in a public API response. Anything that is not an
 * `AppError` is a genuine bug and is re-thrown, so it still reaches the logs and the error
 * boundary rather than being flattened into a tidy 500.
 */
export async function apiHandler(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (!isAppError(error)) throw error
    return new Response(
      JSON.stringify({ error: { id: error.id, message: 'the request could not be completed' } }),
      { status: 500, headers: HEADERS },
    )
  }
}
