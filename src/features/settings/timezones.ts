// The Timezone control's option list: real IANA zones with a GMT offset label.
//
// `Events.timezone` is a free-text column and an unrecognised value used to throw
// `RangeError` out of `Intl` across every agenda surface, the .ics builder and the public
// agenda page (src/features/agenda/time.ts records the outage and the UTC fallback that
// contains it). Settings is where a bad value gets typed, so this screen offers a picker
// of zones the runtime itself accepts rather than a text field.
//
// Labels follow ref 03: `(GMT-8:00) America/Los_Angeles (Pacific...)`. The offset and the
// long zone name are both computed from `Intl` at a given instant, so they are the
// platform's answer and not a table that goes stale when a country changes its rules.

/** One entry in the picker. `value` is the IANA id, which is what gets stored. */
export type TimezoneOption = { readonly value: string; readonly label: string }

/**
 * Used when `Intl.supportedValuesOf` is unavailable, which is a real possibility on
 * workerd rather than a hypothetical: this file runs on the server for the initial render.
 * Deliberately a covering set rather than an apologetic three, so the fallback is still a
 * usable picker. Every id below is checked against `Intl` before it is offered.
 */
const FALLBACK_ZONES: readonly string[] = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Bogota',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Casablanca',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Pacific/Fiji',
]

/** Minutes east of UTC for `zone` at `atMs`, or undefined when Intl rejects the zone. */
export function zoneOffsetMinutes(zone: string, atMs: number): number | undefined {
  const offset = longOffsetOf(zone, atMs)
  if (offset === undefined) return undefined
  // `GMT` on its own is what Intl emits for a zero offset.
  if (offset === 'GMT') return 0
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(offset)
  if (match === null) return undefined
  const [, sign = '+', hours = '0', minutes = '0'] = match
  const total = Number(hours) * 60 + Number(minutes)
  return sign === '-' ? -total : total
}

function longOffsetOf(zone: string, atMs: number): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date(atMs))
    return parts.find((part) => part.type === 'timeZoneName')?.value
  } catch {
    return undefined
  }
}

function longNameOf(zone: string, atMs: number): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'long',
    }).formatToParts(new Date(atMs))
    return parts.find((part) => part.type === 'timeZoneName')?.value
  } catch {
    return undefined
  }
}

/** `(GMT-8:00) America/Los_Angeles (Pacific Standard Time)`, or the bare id if Intl balks. */
export function timezoneLabel(zone: string, atMs: number = Date.now()): string {
  const minutes = zoneOffsetMinutes(zone, atMs)
  if (minutes === undefined) return zone
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  // Hours are NOT zero padded: ref 03 shows `(GMT-8:00)`, not `(GMT-08:00)`.
  const offset = `GMT${sign}${String(Math.floor(absolute / 60))}:${String(absolute % 60).padStart(2, '0')}`
  const name = longNameOf(zone, atMs)
  return name === undefined || name === offset
    ? `(${offset}) ${zone}`
    : `(${offset}) ${zone} (${name})`
}

/**
 * Every zone the runtime knows, west to east, each labelled with its offset.
 *
 * Sorted by offset and then by id, which is how a GMT-offset list reads in every product
 * that has one: an organizer looking for their own zone scans by offset first.
 */
export function timezoneOptions(atMs: number = Date.now()): readonly TimezoneOption[] {
  const ids = supportedZones()
  const entries = ids
    .map((zone) => ({ zone, minutes: zoneOffsetMinutes(zone, atMs) }))
    .filter((entry): entry is { zone: string; minutes: number } => entry.minutes !== undefined)

  entries.sort((left, right) =>
    left.minutes === right.minutes
      ? left.zone.localeCompare(right.zone)
      : left.minutes - right.minutes,
  )

  return entries.map((entry) => ({ value: entry.zone, label: timezoneLabel(entry.zone, atMs) }))
}

function supportedZones(): readonly string[] {
  const supported: unknown =
    'supportedValuesOf' in Intl ? Intl.supportedValuesOf('timeZone') : undefined
  if (Array.isArray(supported) && supported.length > 0) {
    const zones = supported.filter((value): value is string => typeof value === 'string')
    // UTC is not in every runtime's list and it is the mapper's fallback (mapping.ts),
    // so it has to be selectable.
    return zones.includes('UTC') ? zones : ['UTC', ...zones]
  }
  return FALLBACK_ZONES
}
