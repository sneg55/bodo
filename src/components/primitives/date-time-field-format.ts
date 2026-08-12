// The pure conversions behind `DateTimeField`: a day key, a minute of the day, and the two
// shapes the `Calendar` and the native time input each want.
//
// Split out when the component passed the file-size limit. Nothing here touches React or the
// popover, which is also what makes each one directly assertable.

import { dateKeyAt, formatAgendaDate } from '@/features/agenda/time'

/**
 * `October 12th, 2026`, matching the value transcribed in ref 03.
 *
 * The ordinal suffix is done by hand because `Intl.DateTimeFormat` has no option for it
 * and `Intl.PluralRules` with `type: 'ordinal'` gives the category, not the suffix.
 */
export function formatLongDate(dateKey: string): string {
  const base = formatAgendaDate(dateKey, { month: 'long', day: 'numeric', year: 'numeric' })
  const day = Number(dateKey.split('-').at(2) ?? '0')
  return base.replace(String(day), `${String(day)}${ordinalSuffix(day)}`)
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th'
  if (day % 10 === 1) return 'st'
  if (day % 10 === 2) return 'nd'
  if (day % 10 === 3) return 'rd'
  return 'th'
}

/**
 * A `Date` at noon local time on the given day, which is what `Calendar` wants: it works
 * in the browser's own zone, and noon is the hour furthest from a day boundary, so a
 * round trip through the picker cannot land on the neighbouring date.
 */
export function calendarDate(dateKey: string): Date {
  const [year = '1970', month = '01', day = '01'] = dateKey.split('-')
  return new Date(Number(year), Number(month) - 1, Number(day), 12)
}

export function calendarDateKey(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function timeValue(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
}

export function parseTimeValue(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/u.exec(value)
  if (match === null) return undefined
  const [, hours = '0', minutes = '0'] = match
  const total = Number(hours) * 60 + Number(minutes)
  return total >= 0 && total < 24 * 60 ? total : undefined
}

/** Only reached when a time is set before a date, which the empty state allows. */
export function todayKeyIn(timeZone: string): string {
  return dateKeyAt(new Date().toISOString(), timeZone) ?? '1970-01-01'
}
