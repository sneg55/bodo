// Turning what an organizer pastes into the Connect form into the two values the event row
// stores. Pure, and separate from the action for the usual reason: getting it wrong produces
// an integration that looks connected and reaches nothing.
//
// The whole problem is that `accelEventUrl` is NOT a URL despite its name. It is the event's
// path segment, which is what the client interpolates: `/rest/host/event/{eventUrl}/speakers`
// (services/accelevents/client.ts). An organizer's most natural move is to copy the address
// out of their browser, and storing that verbatim builds a request path with a whole URL
// inside it, which 404s with nothing on screen to explain why. So a pasted address is
// reduced to its last meaningful segment rather than refused: refusing would be correct and
// useless, since the value they pasted does contain the answer.

/** What the Connect form produces, once normalized. */
export type AcceleventsMappingInput = {
  eventUrl: string
  remoteEventId?: string
}

export type MappingParseResult =
  | { ok: true; mapping: AcceleventsMappingInput }
  | { ok: false; error: string }

/**
 * Path segments that are never the event's own slug.
 *
 * Their public event addresses look like `.../e/<slug>` and their host console like
 * `.../event/<slug>/...`, so the segment before the slug is a fixed word rather than part of
 * the identifier. Taking the LAST segment blindly would also pick up a trailing page name,
 * which is why the scan walks from the left past these rather than from the right.
 */
const PATH_NOISE = new Set(['e', 'event', 'events', 'eventportal', 'portal'])

/**
 * The event slug out of whatever was pasted.
 *
 * Three shapes are accepted and they are all things an organizer plausibly has on their
 * clipboard: the bare slug, a full `https://` address, and a protocol-relative or
 * host-prefixed path. Query strings and fragments are dropped, because an address copied
 * from a browser carries whatever tracking parameter was on it and none of that is identity.
 */
export function parseAcceleventsEventUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''

  // Split off query and fragment before anything else, so a slug with a `?` on the end does
  // not survive into the stored value and quietly break every request path built from it.
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? ''
  const withoutScheme = withoutQuery.replace(/^[a-z][\w+.-]*:\/\//i, '')
  const segments = withoutScheme.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return ''
  // A bare slug has exactly one segment and no dot in it. Anything with a dot in the first
  // segment came with a host, so that segment is dropped.
  const withoutHost =
    segments.length > 1 && segments[0].includes('.') ? segments.slice(1) : segments

  const meaningful = withoutHost.filter((segment) => !PATH_NOISE.has(segment.toLowerCase()))
  return (meaningful.at(0) ?? withoutHost.at(-1) ?? '').trim()
}

/**
 * The form's two fields, validated together.
 *
 * `eventUrl` is required and `remoteEventId` is not, which is a decision about what counts
 * as connected rather than an oversight. The URL slug is what every read and write path
 * interpolates; the numeric id is needed by some of their endpoints and not others (§5.0e),
 * so a connection that knows the slug is usable and one that knows only the id is not.
 *
 * An empty `remoteEventId` comes back absent rather than as an empty string, so the mutation
 * clears the column instead of storing a blank that later reads as "set to nothing".
 */
export function parseAcceleventsMapping(input: {
  eventUrl: string
  remoteEventId: string
}): MappingParseResult {
  const eventUrl = parseAcceleventsEventUrl(input.eventUrl)
  if (eventUrl === '') {
    return {
      ok: false,
      error: 'Enter the Accelevents event URL or its slug, for example my-conference-2026.',
    }
  }

  const remoteEventId = input.remoteEventId.trim()
  return {
    ok: true,
    mapping: { eventUrl, remoteEventId: remoteEventId === '' ? undefined : remoteEventId },
  }
}
