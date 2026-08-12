// The parts of a send that are the same whichever provider is behind it.
//
// Split out when the AgentMail adapter landed beside the Resend one, because both of
// them need identical treatment of the three things that are easy to get wrong: a
// `fetch` that rejects rather than resolves, base64 that has to survive a speaker's
// name, and a provider error body that has to reach the log line.

import { AppError, ErrorIds } from '@/constants/errorIds'

/** How long to wait on a provider before giving up and letting the outbox retry. */
export const SEND_TIMEOUT_MS = 15_000

export function recipients(to: string | readonly string[]): readonly string[] {
  return typeof to === 'string' ? [to] : to
}

/**
 * The provider's explanation, pulled out of its error body for the log line.
 *
 * Resend answers a rejection with `{ statusCode, name, message }` and AgentMail with a
 * `message` alongside its own error code, so the same reach works for both. Falls back to
 * the raw body, because an unparseable body is still better than a bare status code, and
 * returns empty rather than throwing: a parse failure while building an error message must
 * not replace the error being reported.
 */
export function providerReason(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const reason = (parsed as { message?: unknown }).message
      if (typeof reason === 'string' && reason !== '') return reason
    }
  } catch {
    // Not JSON. The raw body below is the best available.
  }
  return body.slice(0, 200)
}

/**
 * `fetch` rejects rather than resolving for DNS failure, TLS failure, connection
 * reset, and timeout. Those escaped as a raw TypeError or AbortError, so the outbox
 * could not tell a retryable transport problem from a permanent rejection and had
 * no error id to record. Everything that leaves this module is an AppError.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  idempotencyKey: string | undefined,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown'
    throw new AppError(ErrorIds.MAIL_SEND_FAIL, `email transport failed: ${reason}`, {
      // No body and no key material: this lands in logs.
      reason,
      timeoutMs: SEND_TIMEOUT_MS,
      idempotencyKey,
    })
  }
}

/**
 * UTF-8 safe base64. `btoa` alone throws on any code point above 255, and an .ics
 * carries speaker names, so encoding through TextEncoder first is not optional.
 * Chunked because String.fromCharCode with a large spread overflows the call stack.
 */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

/**
 * The bare address out of an EMAIL_FROM that may carry a display name.
 *
 * `EMAIL_FROM` is a header value, so `bodo CFP <cfp@bodo.example.com>` is legitimate and
 * is what a real deployment sets. Resend takes that whole string, but a provider that
 * addresses the sending mailbox by id needs the address on its own.
 */
export function fromAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from)
  return (angled?.[1] ?? from).trim()
}
