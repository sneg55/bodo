const MINUTES_PER_DAY = 24 * 60
const DEFAULT_DURATION_MINUTES = 30

export function dateKeyAt(iso: string, timeZone: string): string | undefined {
  const instant = Date.parse(iso)
  if (Number.isNaN(instant)) return undefined
  const values = numericParts(new Date(instant), timeZone)
  return values === undefined ? undefined : dateKey(values.year, values.month, values.day)
}

export function minutesAt(iso: string, timeZone: string): number | undefined {
  const instant = Date.parse(iso)
  if (Number.isNaN(instant)) return undefined
  const values = numericParts(new Date(instant), timeZone)
  return values === undefined ? undefined : values.hour * 60 + values.minute
}

export function durationMinutes(session: { startsAt?: string; endsAt?: string }): number {
  if (session.startsAt === undefined || session.endsAt === undefined) {
    return DEFAULT_DURATION_MINUTES
  }
  const duration = (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION_MINUTES
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}

export function eventDateKeys(
  startsAt: string | undefined,
  endsAt: string | undefined,
  timeZone: string,
): readonly string[] {
  if (startsAt === undefined) return []
  const startKey = dateKeyAt(startsAt, timeZone)
  const endKey = endsAt === undefined ? startKey : dateKeyAt(endsAt, timeZone)
  if (startKey === undefined || endKey === undefined) return []

  const dates: string[] = []
  let cursor = startKey
  while (cursor <= endKey && dates.length < 31) {
    dates.push(cursor)
    cursor = addCalendarDays(cursor, 1)
  }
  return dates
}

export function monthGridDateKeys(anchorDateKey: string): readonly string[] {
  const parsed = parseDateKey(anchorDateKey)
  if (parsed === undefined) return []
  const first = new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
  const gridStart = addCalendarDays(dateKey(parsed.year, parsed.month, 1), -first.getUTCDay())
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index))
}

export function zonedDateTimeToIso(
  localDateKey: string,
  minuteOfDay: number,
  timeZone: string,
): string | undefined {
  const parsed = parseDateKey(localDateKey)
  if (parsed === undefined || minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) return undefined
  const hour = Math.floor(minuteOfDay / 60)
  const minute = minuteOfDay % 60
  const desired = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute)
  let candidate = desired

  for (let pass = 0; pass < 3; pass += 1) {
    const actual = numericParts(new Date(candidate), timeZone)
    if (actual === undefined) return undefined
    const shown = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    candidate += desired - shown
  }
  return new Date(candidate).toISOString()
}

export function formatAgendaDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  const parsed = parseDateKey(date)
  if (parsed === undefined) return date
  const format = options ?? { month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat('en-US', { ...format, timeZone: 'UTC' }).format(
    new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)),
  )
}

/**
 * The zone's short name at a given instant (`EDT`, `EST`, `GMT+2`), or `undefined`.
 *
 * At a given INSTANT specifically, which is the whole reason this exists: on a fall-back
 * night the same wall-clock hour happens twice under two different abbreviations, and the
 * abbreviation is the only thing that tells the two apart on the page.
 */
export function zoneAbbrevAt(iso: string, timeZone: string): string | undefined {
  const instant = Date.parse(iso)
  if (Number.isNaN(instant)) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date(instant))
    return parts.find((part) => part.type === 'timeZoneName')?.value
  } catch {
    // Same unrecognised-zone case `zonedFormatter` handles. No abbreviation is better
    // than a wrong one, and the caller treats absent as "cannot disambiguate".
    return undefined
  }
}

export function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

/**
 * Every zoned read goes through here, which is why the invalid-zone guard lives here.
 *
 * `Intl.DateTimeFormat` throws `RangeError: Invalid time zone specified` on anything it
 * does not recognise, and `Events.timezone` is a free-text Airtable column: an organizer
 * typing `Pacific Time` instead of `America/Los_Angeles` is enough. (`PST` and `EST` are
 * accepted as legacy aliases, so they do not throw; anything with a space does.) Mapping
 * already turns a BLANK timezone into `UTC` (mapping.ts), so blank was handled and a
 * non-blank wrong value was not, and it took out every caller of this module at once:
 * the agenda views, the .ics builder, and the public agenda page, where it surfaces as a
 * streamed error after the shell has already flushed.
 *
 * Falling back to UTC shows the wrong local times, which is bad, and is still better than
 * a page that does not render: the times shown are at least real instants, and an
 * organizer comparing them against the event's own clock can see that the zone is wrong.
 */
function numericParts(value: Date, timeZone: string) {
  const formatter = zonedFormatter(timeZone)
  const values = new Map(formatter.formatToParts(value).map((part) => [part.type, part.value]))
  const year = Number(values.get('year'))
  const month = Number(values.get('month'))
  const day = Number(values.get('day'))
  const hour = Number(values.get('hour'))
  const minute = Number(values.get('minute'))
  return [year, month, day, hour, minute].every(Number.isFinite)
    ? { year, month, day, hour, minute }
    : undefined
}

/** The formatter `numericParts` needs, or the same formatter in UTC if the zone is junk. */
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone })
  } catch {
    // Only a RangeError from an unrecognised zone can land here: every other option above
    // is a literal. Deliberately not rethrown, and not logged per-call either, because
    // this runs once per session per render and would bury the log it belongs in.
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
  }
}

function addCalendarDays(value: string, days: number): string {
  const parsed = parseDateKey(value)
  if (parsed === undefined) return value
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days))
  return dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return undefined
  const [, year = '', month = '', day = ''] = match
  return { year: Number(year), month: Number(month), day: Number(day) }
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
