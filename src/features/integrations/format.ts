// Two formatters the Integrations surface shares, and one predicate behind both.
//
// Split out of model.ts when that file reached the size limit, and they belong together
// for a better reason than line count: both are about presenting a value that arrives as a
// string and may be absent or malformed, which is the one thing every column on this page
// has in common.

/**
 * An instant in the event's timezone.
 *
 * The event's zone rather than the browser's, like every other admin surface: an organizer
 * reading a sync log is asking when it happened AT THE CONFERENCE, and a run stamped 03:12
 * because the reader is in another country is a support ticket.
 *
 * An unparseable value comes back as it was stored. `Intl` would render `Invalid Date`,
 * which tells the reader nothing about the row and hides the string that would.
 */
export function formatInstant(iso: string, timeZone: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)
}

/**
 * A browsable link to the remote event, when there is honestly one to give.
 *
 * `Events.accelEventUrl` is named "URL" and is not one: every path in
 * `services/accelevents/client.ts` is built with it as a path segment, so what the column
 * holds is the event's slug on their side. Their published index documents the API host and
 * nothing about the shape of a public event page, so synthesising one would ship a link
 * that 404s and reads as bodo's fault. An absolute URL an organizer pasted in IS linkable,
 * and that is the only case that returns one.
 */
export function remoteEventHref(eventUrl: string | undefined): string | undefined {
  if (!hasText(eventUrl)) return undefined
  const trimmed = eventUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return undefined
  try {
    return new URL(trimmed).toString()
  } catch {
    return undefined
  }
}

/** Whitespace is absence. An `accelEventUrl` of "   " maps this event to nothing. */
export function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}
