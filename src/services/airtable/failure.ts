// Turning an Airtable error response into an AppError somebody can act on.
//
// Split out of client.ts, which now only calls this. The reason it is worth its own file
// is the reason the detail below exists at all: on 2026-08-09 a read on AiPrescreenJobs
// failed repeatedly on the deployed Worker and the tail said only
// `AppError: AiPrescreenJobs: read rejected`. The status and Airtable's own reason were
// both already on the error, in `context`, and neither reached the log, because what gets
// printed is the message. Diagnosing a recurring production failure needed a deploy purely
// to discover what the status code was.
//
// So the message carries the status and the error type, and `context` keeps the body for
// anything reading errors structurally.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { RequestKind } from '@/services/airtable/read-cache'

/** Enough of the body to be useful in a log line, not enough to flood one. */
const BODY_LIMIT = 300

/**
 * Airtable's own reason for refusing, pulled out of the error body.
 *
 * The shape is `{"error":{"type":"INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND","message":...}}`
 * and the `type` is the part worth carrying: it names the cause where the status alone
 * names only a family. Airtable also has an older form where `error` is a bare string.
 * Anything unparseable contributes nothing rather than smuggling a whole HTML error page
 * into a log line.
 */
export function describeFailure(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null || typeof parsed !== 'object') return ''
    const error: unknown = (parsed as { error?: unknown }).error
    if (typeof error === 'string') return ` ${error}`
    if (error === null || typeof error !== 'object') return ''
    const type: unknown = (error as { type?: unknown }).type
    return typeof type === 'string' ? ` ${type}` : ''
  } catch {
    // A body that is not JSON tells us nothing Airtable meant to say.
    return ''
  }
}

/**
 * The error for a non-OK Airtable response.
 *
 * `404` stays its own id because callers branch on it (a missing record is a normal
 * outcome, not a fault). Everything else is a read or a write failure depending on what
 * was attempted, and the status decides nothing beyond that: a 429 or a 5xx never reaches
 * here, because the scheduler retries those and only gives up with its own error.
 */
export async function failureFor(
  response: Response,
  table: string,
  kind: RequestKind,
): Promise<AppError> {
  // Airtable puts the useful part in the body, so an error without it is an error nobody
  // can act on. Read defensively: a body that has already been consumed throws.
  const body = await response.text().catch(() => '')
  const context = { table, status: response.status, body: body.slice(0, BODY_LIMIT) }

  if (response.status === 404) {
    return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, `${table}: not found`, context)
  }

  const reason = `${String(response.status)}${describeFailure(body)}`
  if (kind === 'write') {
    return new AppError(ErrorIds.DATA_WRITE_FAIL, `${table}: write rejected (${reason})`, context)
  }
  return new AppError(ErrorIds.NET_BAD_SHAPE, `${table}: read rejected (${reason})`, context)
}
