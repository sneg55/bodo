// Generic in-memory search, filter, sort and paginate engine over `DataTableFilter`.
//
// Extracted out of `src/features/review/abstracts-filter.ts`, which was a complete
// engine except for three row accessors. Those accessors are injected here as
// `RowAccessors<TRow>` instead of imported, so a second row type (the speaker CRM)
// can reuse this module rather than fork it. Anything Abstracts-specific (tabs,
// track, status) stayed behind in abstracts-filter.ts.

import type { DataTableFilter, DataTableSort } from '@/components/primitives/data-table-types'

export type RowAccessors<TRow> = {
  text: (row: TRow, key: string) => string | undefined
  numeric: (key: string) => boolean
  number: (row: TRow, key: string) => number | undefined
  searchableKeys: readonly string[]
  /**
   * The individual values of a MULTI-VALUED column, where the surface has one.
   *
   * `text` flattens such a column to something readable, which is right for search and for
   * sort and wrong for a filter: the CRM's Speaker Tags accessor joins to `AI, Infra`, so
   * `Speaker Tags is AI` was FALSE for a speaker carrying the AI tag, and an organizer who
   * asked for one tag got back a set that did not match what they asked for. Verified
   * against the real accessors before it was changed, not inferred.
   *
   * Optional, and `undefined` for a key means "single-valued, compare the text". A surface
   * with no multi-valued columns at all can leave the whole accessor off.
   */
  list?: (row: TRow, key: string) => readonly string[] | undefined
}

export function matchesSearch<TRow>(
  row: TRow,
  query: string,
  accessors: RowAccessors<TRow>,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return accessors.searchableKeys.some((key) =>
    (accessors.text(row, key) ?? '').toLowerCase().includes(needle),
  )
}

function matchesOneFilter<TRow>(
  row: TRow,
  filter: DataTableFilter,
  accessors: RowAccessors<TRow>,
): boolean {
  const value = accessors.text(row, filter.key)
  // A filter on a column this surface does not render cannot be evaluated, so it is
  // ignored rather than silently hiding every row. Stored views outlive column sets.
  if (value === undefined) return true

  const expected = filter.value.trim().toLowerCase()
  // The cell's values, one per entry. A single-valued column is the one-element case, so
  // there is one comparison path rather than two that can drift.
  const values = (accessors.list?.(row, filter.key) ?? [value]).map((each) =>
    each.trim().toLowerCase(),
  )
  const present = values.filter((each) => each.length > 0)

  switch (filter.operator) {
    // ANY value matches, which is what an organizer means by "Speaker Tags is AI" on a
    // person carrying AI and two other tags. Comparing the flattened cell instead made that
    // condition false, so the answer excluded exactly the rows it was asked for.
    case 'is':
      return present.some((each) => each === expected)
    // EVERY value must differ, which is the honest negation of the case above: "is not AI"
    // has to exclude somebody tagged AI and Infra, not merely somebody tagged AI alone.
    case 'is_not':
      return !present.some((each) => each === expected)
    case 'contains':
      return present.some((each) => each.includes(expected))
    case 'is_empty':
      return present.length === 0
    case 'is_not_empty':
      return present.length > 0
  }
}

export function matchesFilters<TRow>(
  row: TRow,
  filters: readonly DataTableFilter[],
  accessors: RowAccessors<TRow>,
): boolean {
  return filters.every((filter) => matchesOneFilter(row, filter, accessors))
}

/**
 * Missing values sort last in BOTH directions.
 *
 * Deliberate, and it is the reason this is not a one-line comparator. An organizer
 * sorting Ratings descending is looking for the strongest submissions; an organizer
 * sorting ascending is looking for the weakest. In neither case are they looking for
 * the forty rows nobody has reviewed, and a plain comparator puts those at one end
 * or the other where they bury the answer.
 */
function sortValue<TRow>(
  row: TRow,
  key: string,
  accessors: RowAccessors<TRow>,
): number | string | undefined {
  if (accessors.numeric(key)) return accessors.number(row, key)
  const text = accessors.text(row, key) ?? ''
  return text.length === 0 ? undefined : text
}

function compare<TRow>(
  left: TRow,
  right: TRow,
  sort: DataTableSort,
  accessors: RowAccessors<TRow>,
): number {
  const a = sortValue(left, sort.key, accessors)
  const b = sortValue(right, sort.key, accessors)

  if (a === undefined || b === undefined) {
    if (a === undefined && b === undefined) return 0
    return a === undefined ? 1 : -1
  }

  const direction = sort.direction === 'desc' ? -1 : 1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction
  return String(a).localeCompare(String(b)) * direction
}

export function sortRows<TRow>(
  rows: readonly TRow[],
  sort: DataTableSort | null,
  accessors: RowAccessors<TRow>,
): readonly TRow[] {
  if (sort === null) return rows
  // Copied before sorting: the input is a cached read's array in every real caller,
  // and sorting it in place would mutate what the cache hands the next request.
  return [...rows].sort((left, right) => compare(left, right, sort, accessors))
}

export type PagedRows<TRow> = {
  readonly rows: readonly TRow[]
  readonly totalRows: number
  /** Clamped, so a stale page number cannot render an empty table for no reason. */
  readonly page: number
}

export function pageRows<TRow>(
  rows: readonly TRow[],
  page: number,
  pageSize: number,
): PagedRows<TRow> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(Math.max(page, 1), pageCount)
  const start = (safePage - 1) * pageSize
  return { rows: rows.slice(start, start + pageSize), totalRows: rows.length, page: safePage }
}
