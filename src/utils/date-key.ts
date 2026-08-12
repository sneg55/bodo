// A bare calendar date as `YYYY-MM-DD`, and the `Date` a picker wants back.
//
// Three drawers hold a date with no time of day (a file request deadline, a task deadline, a
// session's day) and each turns it into an instant in the EVENT's zone at the action, not
// here. Lifted out of `features/file-requests/request-draft.ts` so `DateKeyField` in
// components/primitives can use it without a primitive importing from a feature.
//
// LOCAL fields, never `toISOString()`. An organizer west of UTC picking the 14th late in the
// evening gets the 15th out of `toISOString`, so the deadline they set is a day later than
// the one they clicked.

/** The date a picker returned, as the key that gets stored. */
export function dateKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/**
 * The key back as the `Date` the calendar shows as selected, or nothing when it is unset or
 * malformed.
 *
 * At NOON local, the same trick `DateTimeField` uses: noon is the hour furthest from a day
 * boundary, so a round trip through the picker cannot land on the neighbouring date.
 */
export function dateKeyValue(key: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(key)
  if (match === null) return undefined
  const [, year = '1970', month = '01', day = '01'] = match
  return new Date(Number(year), Number(month) - 1, Number(day), 12)
}
