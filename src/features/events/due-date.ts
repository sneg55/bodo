// A deadline typed into a form, read as an instant in the EVENT's timezone.
//
// One copy, shared by the task and file-request actions. It was written twice, identically,
// and both copies had the same gap, which is the argument for it living here: a rule about
// what a date means is not something two files should each have an opinion about.
//
// Why the zone matters at all: `dueAt` is a UTC date-time column and every surface renders
// it back in the event's zone, so storing the typed text verbatim made the two disagree by
// the offset. A 23:59 deadline for a California event stored as 23:59Z reads as 16:59
// there, and an early-morning one lands on the previous date. `zonedDateTimeToIso` is the
// helper the agenda already uses to place a dropped session, DST edges included.

import { zonedDateTimeToIso } from '@/features/agenda/time'

/** 23:59, the last minute of the day a date-only deadline names. */
const END_OF_DAY_MINUTES = 23 * 60 + 59

/**
 * Accepts a bare date, a `datetime-local` value, or a full instant.
 *
 * The BARE DATE case is the one that was missing, and its absence is why two task items
 * were scored partial. Both sheets used `<input type="datetime-local">`, which yields the
 * empty string unless the date and the time segments are BOTH filled: an organizer who
 * picked a date and left the time alone submitted nothing at all, and got a task with no
 * deadline, no validation message and nothing on screen to explain it. Both controls are
 * now plain dates, which cannot be half-filled.
 *
 * A bare date means the END of that day, not midnight. Midnight would make "due the 25th"
 * fall due the instant the 24th ends, which is a day early and the kind of off-by-one
 * nobody reports: they just quietly stop trusting the column.
 *
 * A value that is already a full instant is passed through untouched, so a caller that
 * hands over ISO keeps working.
 */
export function eventInstant(local: string | undefined, timeZone: string): string | undefined {
  if (local === undefined || local.trim().length === 0) return undefined
  const trimmed = local.trim()

  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/u.exec(trimmed)
  if (dateOnly !== null) return zonedDateTimeToIso(dateOnly[1], END_OF_DAY_MINUTES, timeZone)

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/u.exec(trimmed)
  if (match === null) return trimmed
  const [, dateKey = '', hour = '0', minute = '0'] = match
  return zonedDateTimeToIso(dateKey, Number(hour) * 60 + Number(minute), timeZone)
}
