// `Date/Time Format`, applied. R9.
//
// Reference: docs/parity/external-references.md, "Embed Style Options". ONE option label is
// captured and it is a specimen of its own output: `English (US): Fri, June 3, 2022 at 11:00 PM`.
// So the `en_us_long` shape below is transcribed off the label rather than chosen: short weekday,
// long month, day, year, then the word `at`, then a 12-hour clock. `iso` is authored, and exists so
// the Select has two operable options instead of one (src/migrations/tables-cms.ts says why the
// alternative was not to invent four more locales).
//
// This module exists because the alternative was worse. The served embed's day labels and clock
// times are produced by `groupPublicSchedule`, which formats one way and belongs to the public
// agenda page. Reformatting there would change `/agenda/<slug>` too, for every event, to satisfy a
// per-embed setting. So the projection re-labels its own output through the functions here, and
// nothing outside the CMS feature changes.
//
// NOTHING HERE CALLS A DATE METHOD DIRECTLY. Every conversion goes through @/features/agenda/time,
// which resolves an instant in a named timezone and falls back to UTC on a zone an organizer
// mistyped. Workers run `Date` and `Intl` in UTC, so a bare `toLocaleString` on this path would
// show a 9am session at 4pm to every reader of the conference's own website.

import { UNDATED_DAY_KEY, UNDATED_DAY_LABEL } from '@/features/agenda/public-schedule'
import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt } from '@/features/agenda/time'
import type { EmbedDateFormat } from '@/types/cms'

/** A `YYYY-MM-DD` key, which is what `groupPublicSchedule` groups by. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/u

/** What a session needs to carry to be stamped. `EmbedSourceRow` satisfies it. */
export type EmbedSlot = { startsAt?: string; endsAt?: string }

/**
 * A day heading.
 *
 * The undated bucket keeps the public agenda's own wording under both formats: it is not a date, so
 * there is no format to apply, and inventing a second phrase for the same situation would make the
 * embed and `/agenda/<slug>` disagree about what a session with no time is called.
 */
export function embedDayLabel(dateKey: string, format: EmbedDateFormat): string {
  if (dateKey === UNDATED_DAY_KEY) return UNDATED_DAY_LABEL
  if (!DATE_KEY.test(dateKey)) return dateKey
  if (format === 'iso') return dateKey
  return formatAgendaDate(dateKey, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * A session's clock range, in the event's timezone, or `undefined` when it has no start.
 *
 * Deliberately simpler than `groupPublicSchedule`'s own slot label, which disambiguates a range
 * crossing midnight or a daylight-saving fall-back. Both of those append text to the range, and
 * the captured option label is a fixed shape; a reader of a filtered embed is better served by the
 * shape they chose than by an annotation that only appears twice a year. The absent-end and
 * unparseable-instant cases are handled the same way as there, because those are silent.
 */
export function embedTimeLabel(
  slot: EmbedSlot,
  timeZone: string,
  format: EmbedDateFormat,
): string | undefined {
  if (slot.startsAt === undefined) return undefined
  const start = minutesAt(slot.startsAt, timeZone)
  if (start === undefined) return undefined

  const end = slot.endsAt === undefined ? undefined : minutesAt(slot.endsAt, timeZone)
  const from = clock(start, format)
  return end === undefined ? from : `${from} - ${clock(end, format)}`
}

/**
 * The flat Session List's one-line stamp.
 *
 * `at` between the two halves under the captured option, because that is the word its own label
 * uses: `Fri, June 3, 2022 at 11:00 PM`. A space under ISO, because that is how an ISO datetime is
 * written and `at` in the middle of one would not be ISO.
 */
export function embedStamp(
  dayLabel: string,
  time: string | undefined,
  format: EmbedDateFormat,
): string {
  if (time === undefined) return dayLabel
  return format === 'iso' ? `${dayLabel} ${time}` : `${dayLabel} at ${time}`
}

/** The day key a session falls on in the event's timezone, for the flat view's own date. */
export function embedSlotDayKey(slot: EmbedSlot, timeZone: string): string {
  if (slot.startsAt === undefined) return UNDATED_DAY_KEY
  return dateKeyAt(slot.startsAt, timeZone) ?? UNDATED_DAY_KEY
}

/** `11:00 PM` or `23:00`, from a minute of the day. */
function clock(minutes: number, format: EmbedDateFormat): string {
  if (format !== 'iso') return formatMinutes(minutes)
  const hour = Math.floor(minutes / 60)
  return `${pad(hour)}:${pad(minutes % 60)}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
