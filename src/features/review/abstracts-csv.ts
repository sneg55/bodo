// CSV export of the current view.
//
// "Exports are cheap and worth building (stream the current view's rows and visible
// columns, so exports respect the Preferences drawer)" (BUILD_SPEC 5.4). So the export
// takes the same query the table is rendering and the same column keys, and it reads
// values through the same `rowText` accessors the sort and the filter use. One source of
// truth for what a column contains, which is why a renamed column cannot silently export
// blank.
//
// Pure. The action that calls it is in export-actions.ts.

import { registryField } from '@/constants/fields'
import { dateKeyAt } from '@/features/agenda/time'
import { rowText } from '@/features/review/abstracts-accessors'
import type { AbstractRow } from '@/features/review/abstracts-rows'

/**
 * Quote per RFC 4180: wrap when the value contains a comma, a quote, or a newline, and
 * double any embedded quote.
 *
 * The leading-character guard is not paranoia about CSV, it is about spreadsheets: a cell
 * starting `=`, `+`, `-`, or `@` is evaluated as a formula by Excel and Sheets, so an
 * abstract titled "-2 hours of your life" becomes an error cell, and a hostile submitter
 * can do worse than that. Prefixing a tab neutralises it and displays identically.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value
  if (!/[",\r\n\t]/.test(guarded)) return guarded
  return `"${guarded.replaceAll('"', '""')}"`
}

/** CRLF, which is what RFC 4180 specifies and what Excel expects. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * Column keys the export can actually render. A key with no accessor is dropped rather
 * than exported as an empty column, because stored column preferences outlive any one
 * surface's column set (the same rule DataTable applies when it drops an unknown key).
 */
export function csvHeaderFor(key: string, ratingsLabel: string): string | undefined {
  if (key === 'ratings') return ratingsLabel
  if (key === 'submitter') return 'Session Submitter'
  if (key === 'speakers') return 'Speaker'
  return registryField(key)?.label
}

export function abstractsToCsv(
  rows: readonly AbstractRow[],
  columnKeys: readonly string[],
  ratingsLabel: string,
): string {
  const columns = columnKeys.flatMap((key) => {
    const header = csvHeaderFor(key, ratingsLabel)
    return header === undefined ? [] : [{ key, header }]
  })

  return toCsv([
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => rowText(row, column.key) ?? '')),
  ])
}

/**
 * `abstracts-2026-08-08.csv`. Dated so two exports do not overwrite each other.
 *
 * Dated in the EVENT's zone, which is the zone every other date on this surface is
 * formatted in (`abstracts-rows.ts` passes `event.timezone` to `dateText`). Slicing the
 * ISO instant named the file in UTC, so an export taken at 20:36 in Los Angeles came out
 * `submissions-2026-08-10.csv` under a page header reading SUNDAY, AUGUST 9.
 *
 * The zone defaults to UTC so the slice's behaviour is what a caller with no event still
 * gets, and an unparseable instant falls back to the slice rather than to today.
 */
export function csvFilename(prefix: string, nowIso: string, timeZone = 'UTC'): string {
  return `${prefix}-${dateKeyAt(nowIso, timeZone) ?? nowIso.slice(0, 10)}.csv`
}
