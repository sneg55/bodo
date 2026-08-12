// The download link, and why it is plain query parameters rather than a signed token.
//
// The reference makes the action asynchronous: `Generate Download`, then "You will receive
// an email once the file is ready to download". So the request and the download are two
// different HTTP requests minutes apart, and something has to carry the selection between
// them. Three options were considered:
//
//   - A signed token. Rejected because the signature would protect nothing. The route
//     authorizes with `requireEventRole` on the request's own session and re-derives the
//     event's sessions and speakers from event-scoped reads, so tampering with these
//     parameters can only ever produce a bundle of files the caller was already entitled to
//     download. A signature would add a key, a rotation story and a second failure mode in
//     exchange for no capability.
//   - A spec object in R2. Rejected because the uploads bucket has a public base URL
//     (R2_PUBLIC_BASE_URL, services/storage/uploads), so parking a manifest of object keys
//     in it would publish exactly the map an attacker wants.
//   - A spec in KV. Rejected because wrangler.jsonc scopes BODO_KV to "rate limits and
//     other best-effort counters ONLY", and a download that 404s because an eventually
//     consistent read had not landed yet is a worse bug than a long URL.
//
// So the URL IS the request, it is not a capability, and the session is. What that costs is
// length, which is why MAX_BUNDLE_SESSIONS is 50: fifty record ids plus the opt-outs sit
// comfortably under the 2 KB a mail client will carry.
//
// Pure and round-trip tested (tests/bundle-link.test.ts), because a parameter name that
// disagrees between the builder and the parser produces an email whose link downloads the
// wrong selection with no error anywhere.

import { type BundleGrouping, parseGrouping } from '@/features/bundle/grouping'

export const BUNDLE_DOWNLOAD_PATH = '/api/files/bundle'

const PARAM = {
  eventId: 'eventId',
  sessions: 'sessions',
  group: 'group',
  omit: 'omit',
} as const

export type BundleRequest = {
  readonly eventId: string
  readonly sessionIds: readonly string[]
  readonly grouping: BundleGrouping
  /** Files the organizer unticked in the modal. */
  readonly deselectedFileIds: readonly string[]
}

/** Comma separated rather than a repeated key: shorter, and it survives a mail rewriter. */
function joinIds(ids: readonly string[]): string {
  return ids.join(',')
}

function splitIds(value: string | null): readonly string[] {
  if (value === null) return []
  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ]
}

export function bundleDownloadQuery(request: BundleRequest): string {
  const params = new URLSearchParams()
  params.set(PARAM.eventId, request.eventId)
  params.set(PARAM.sessions, joinIds(request.sessionIds))
  params.set(PARAM.group, request.grouping)
  if (request.deselectedFileIds.length > 0) {
    params.set(PARAM.omit, joinIds(request.deselectedFileIds))
  }
  return params.toString()
}

/** The path plus query, relative. The email prefixes it with `appUrl()`. */
export function bundleDownloadPath(request: BundleRequest): string {
  return `${BUNDLE_DOWNLOAD_PATH}?${bundleDownloadQuery(request)}`
}

/**
 * The request a download URL describes.
 *
 * Nothing here is trusted: `eventId` is what `requireEventRole` is then asked about, the
 * session ids are intersected with the event's own, and an unknown grouping falls back to
 * the default. So a malformed URL produces a smaller bundle or a 401, never a wider one.
 */
export function parseBundleRequest(params: URLSearchParams): BundleRequest {
  return {
    eventId: (params.get(PARAM.eventId) ?? '').trim(),
    sessionIds: splitIds(params.get(PARAM.sessions)),
    grouping: parseGrouping(params.get(PARAM.group)),
    deselectedFileIds: splitIds(params.get(PARAM.omit)),
  }
}

/**
 * A stable id for one bundle request.
 *
 * Deterministic on purpose, and it is deterministic over the SORTED ids so that ticking the
 * same rows in a different order is the same request. Two things key on it: the outbox
 * idempotency key, so a double-clicked `Generate Download` queues one email, and the
 * `claimOnce` key that makes the pair of writes behind it happen once. See ./request.
 *
 * FNV-1a rather than SHA-256, and rather than the joined string itself. Not for secrecy: this id
 * is never a capability, and the URL is what carries the selection while the session is what
 * authorizes it. It is short because it ends up in `EmailOutbox.idempotencyKey`, which
 * `existingOutboxKeys` compares inside an Airtable formula, and fifty record ids joined raw would
 * be a 900 character literal in that formula. `crypto.subtle` would work too and would make every
 * caller of this async for nothing.
 *
 * SIXTY-FOUR BITS, not thirty-two, and the width is the correctness argument rather than a
 * precaution. A collision here is not an information leak, but it IS a lost email: two colliding
 * selections share an `idempotencyKey`, and `enqueueEmails` upserts on that key, so the second
 * organizer's bundle silently suppresses the first's. Codex review demonstrated a collision at 32
 * bits by appending ids to the raw request, so this is a produced collision and not a birthday
 * estimate. Two independent FNV-1a passes, the second over the reversed material with a different
 * offset basis, cost eight more characters in the formula and no async.
 */
export function bundleRequestId(request: BundleRequest): string {
  const material = [
    request.eventId,
    request.grouping,
    [...request.sessionIds].sort().join(','),
    [...request.deselectedFileIds].sort().join(','),
  ].join('|')

  const high = fnv1a(material, 0x811c_9dc5)
  // Reversed, so the two halves are not the same function of the same byte order: a pair of
  // strings crafted to collide in one pass has no reason to collide in the other.
  const low = fnv1a([...material].reverse().join(''), 0x01000193)
  return `${hex8(high)}${hex8(low)}`
}

function fnv1a(material: string, basis: number): number {
  let hash = basis
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0
    // The FNV prime, as shifts, because `hash * 16777619` leaves float range immediately.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }
  return hash
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0')
}
