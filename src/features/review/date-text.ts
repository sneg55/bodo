// Dates rendered to text on the server, in the event's own timezone.
//
// The admin table is a client component, so if it formatted timestamps itself the
// server and the browser would disagree whenever their timezones differ, which is a
// hydration mismatch on a screen full of dates. Formatting here means the client
// receives strings it cannot get wrong, the same reason `AdminShellSlots` hands the
// sidebar a pre-formatted date range.
//
// The event's timezone, not the viewer's: a session at 09:00 in Portland is at 09:00
// for the organizer in Berlin too, because the schedule belongs to the venue.

const FORMATS = new Map<string, Intl.DateTimeFormat>()

/**
 * Cached per (locale, timezone, kind). Building an `Intl.DateTimeFormat` is the
 * expensive part and a table of forty rows with four date columns would otherwise
 * build 160 of them per render.
 *
 * The cache is module-level and immutable-by-key, which is safe on `workerd`: it is a
 * memoised pure function, not mutable state standing in for a cache, so an isolate
 * being recycled costs nothing but a rebuild.
 */
function formatter(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}:${withTime ? 'dt' : 'd'}`
  const existing = FORMATS.get(key)
  if (existing !== undefined) return existing

  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  })
  FORMATS.set(key, created)
  return created
}

/**
 * `undefined` in gives the empty string out, and a value the runtime cannot parse gives
 * the empty string too. Callers render the empty-cell placeholder for both, which is
 * correct: an unreadable timestamp is not information, and throwing here would take out
 * a whole cached table over one bad cell.
 */
export function dateTimeText(iso: string | undefined, timeZone: string): string {
  if (iso === undefined || iso.length === 0) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatter(timeZone, true).format(parsed)
}

export function dateText(iso: string | undefined, timeZone: string): string {
  if (iso === undefined || iso.length === 0) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatter(timeZone, false).format(parsed)
}
