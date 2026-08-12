// How a column key turns into a value to search, filter or sort by.
//
// Split from `abstracts-rows.ts` for the file-size limit, and the seam is a real one: that
// file builds the row, this one reads it. Nothing here knows how a row was assembled and
// nothing there knows what is orderable.

import type { AbstractRow } from '@/features/review/abstracts-rows'
import { ratingSortValue, ratingText } from '@/features/review/ratings'

/**
 * Column key to the text a search, a filter, or a sort compares against.
 *
 * A Map of accessors rather than `row[key]`: the key arrives from stored column
 * preferences, and a dynamic index into a plain object is what
 * `security/detect-object-injection` blocks the build over. It also means a key with
 * no accessor is a miss instead of `undefined` leaking into a comparison.
 */
const TEXT_ACCESSORS: ReadonlyMap<string, (row: AbstractRow) => string> = new Map([
  ['code', (row) => row.code],
  ['title', (row) => row.title],
  ['status', (row) => row.status],
  ['source', (row) => row.sourceLabel],
  ['description', (row) => row.description],
  ['format', (row) => row.format ?? ''],
  ['level', (row) => row.level ?? ''],
  ['language', (row) => row.language ?? ''],
  ['track', (row) => row.track?.name ?? ''],
  ['tags', (row) => row.tags.map((tag) => tag.name).join(', ')],
  ['room', (row) => row.roomName ?? ''],
  ['scheduleStatus', (row) => row.scheduleStatus],
  ['location', (row) => row.location ?? ''],
  ['clientSessionId', (row) => row.clientSessionId ?? ''],
  ['notifiedAt', (row) => row.notifiedAt ?? ''],
  ['submittedAt', (row) => row.submittedAt ?? ''],
  ['startsAt', (row) => row.startsAt ?? ''],
  ['endsAt', (row) => row.endsAt ?? ''],
  ['ceuCredits', (row) => (row.ceuCredits === undefined ? '' : String(row.ceuCredits))],
  ['capacity', (row) => (row.capacity === undefined ? '' : String(row.capacity))],
  ['ratings', (row) => ratingText(row.rating)],
  ['submitter', (row) => row.submitterEmail],
  ['speakers', (row) => row.speakers.join(', ')],
  ['chairperson', (row) => row.chairpersons.join(', ')],
])

export function rowText(row: AbstractRow, key: string): string | undefined {
  return TEXT_ACCESSORS.get(key)?.(row)
}

/**
 * The MULTI-VALUED columns, unjoined, so a filter compares against each value.
 *
 * The three above flatten to `AI, Infra` for the cell, for search and for sort, and a filter
 * comparing that whole string is wrong: `Tags is AI` was false for a session tagged AI and
 * Infra, and `Speakers is Ada Okafor` was false for anything with a co-speaker. The same
 * arrays those accessors join, rather than splitting their output back on a comma, which
 * breaks on the first tag or company name containing one.
 */
const LIST_ACCESSORS: ReadonlyMap<string, (row: AbstractRow) => readonly string[]> = new Map([
  ['tags', (row: AbstractRow) => row.tags.map((tag) => tag.name)],
  ['speakers', (row: AbstractRow) => row.speakers],
  ['chairperson', (row: AbstractRow) => row.chairpersons],
])

export function rowValues(row: AbstractRow, key: string): readonly string[] | undefined {
  return LIST_ACCESSORS.get(key)?.(row)
}

/** Numeric sort keys, so 9 does not sort after 10 the way its string form does. */
const NUMBER_ACCESSORS: ReadonlyMap<string, (row: AbstractRow) => number | undefined> = new Map([
  ['ceuCredits', (row) => row.ceuCredits],
  ['capacity', (row) => row.capacity],
  ['ratings', (row) => ratingSortValue(row.rating)],
])

export function rowNumber(row: AbstractRow, key: string): number | undefined {
  return NUMBER_ACCESSORS.get(key)?.(row)
}

/**
 * Whether a column sorts numerically. Asked before reading a value rather than
 * inferred from one, because inferring makes the comparator depend on the first row
 * it happens to see: a Ratings column whose first row is unscored would fall back to
 * comparing "n/a" against "84%" as text.
 */
export function hasNumericSort(key: string): boolean {
  return NUMBER_ACCESSORS.has(key)
}

/**
 * Every column this surface can order or filter by: exactly the keys an accessor exists
 * for, derived from the two maps above rather than listed a third time.
 *
 * This is what the Sort and Filter panes offer, and it is the fix for the Ratings column
 * being unsortable. Those panes used to offer `column: true` from the field registry,
 * which means "there is a real Airtable column behind this" and is a fact about the
 * schema, not about this table. Sorting and filtering both happen in code here, over rows
 * already loaded, so the schema has no say in it: the only thing that decides is whether
 * `rowText` or `rowNumber` can answer. Ratings is derived from Reviews and has no
 * Submissions column, so the registry says `column: false` and the picker silently
 * dropped the one column an organizer most wants to rank by.
 *
 * Offering a key with no accessor would be worse than omitting it. `sortValue` would
 * return `undefined` for every row, so the sort would be a control that visibly does
 * nothing, and `matchesFilter` returns `true` for an unanswerable key, so the filter
 * would match everything.
 */
export const SORTABLE_ROW_KEYS: ReadonlySet<string> = new Set([
  ...TEXT_ACCESSORS.keys(),
  ...NUMBER_ACCESSORS.keys(),
])

/** The columns the free-text search box scans. Everything else needs a filter. */
export const SEARCHABLE_KEYS: readonly string[] = [
  'code',
  'title',
  'description',
  'track',
  'tags',
  'speakers',
  'submitter',
  'clientSessionId',
]
