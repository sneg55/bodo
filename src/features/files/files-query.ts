// The Files list's search, filter and sort, over the row model it already renders.
//
// It exists for the same reason `deliverable-query.ts` does: the drawer on this table offered
// the SESSION registry's 22 fields and committed nothing, so Columns, Sort and Filter were
// three controls that could not affect the table whatever an organizer chose. A pane offering
// a key with no accessor behind it is worse than an absent pane, because a filter on such a
// key matches every row and reads as the data being wrong.
//
// So `queryableFields` in files-columns.tsx is exactly the keys below. Link and Comments are
// deliberately not among them: one is a pair of buttons and the other is a thread, and neither
// is a value anybody means to order by.
//
// Pure, and tested in tests/files-query.test.ts.

import type { DataTableFilter, DataTableSort } from '@/components/primitives/data-table-types'
import type { FileListRow } from '@/features/files/reads'
import {
  matchesFilters,
  matchesSearch,
  type RowAccessors,
  sortRows,
} from '@/features/views/table-query'

const TEXT: ReadonlyMap<string, (row: FileListRow) => string> = new Map([
  ['filename', (row: FileListRow) => row.filename],
  ['file-type', (row: FileListRow) => row.typeLabel],
  ['file-owner', (row: FileListRow) => row.speakerLabel],
  ['file-session', (row: FileListRow) => row.sessionLabel ?? ''],
  ['file-size', (row: FileListRow) => row.sizeLabel],
  ['file-uploaded', (row: FileListRow) => row.uploadedText],
])

/** Sorted on the ISO instant, not on the rendered text: `Aug 9` after `Dec 1` is not an order. */
const NUMERIC: ReadonlyMap<string, (row: FileListRow) => number | undefined> = new Map([
  [
    'file-uploaded',
    (row: FileListRow) => {
      const parsed = Date.parse(row.uploadedAt)
      return Number.isNaN(parsed) ? undefined : parsed
    },
  ],
])

export const FILE_ACCESSORS: RowAccessors<FileListRow> = {
  text: (row, key) => TEXT.get(key)?.(row),
  numeric: (key) => NUMERIC.has(key),
  number: (row, key) => NUMERIC.get(key)?.(row),
  searchableKeys: ['filename', 'file-owner', 'file-session', 'file-type'],
}

/** The keys the Sort and Filter panes may offer, which is the set that has an accessor. */
export const FILE_QUERYABLE_KEYS: ReadonlySet<string> = new Set(TEXT.keys())

export function queryFiles(
  rows: readonly FileListRow[],
  query: {
    search: string
    filters: readonly DataTableFilter[]
    sort: DataTableSort | null
  },
): readonly FileListRow[] {
  const matched = rows.filter(
    (row) =>
      matchesSearch(row, query.search, FILE_ACCESSORS) &&
      matchesFilters(row, query.filters, FILE_ACCESSORS),
  )
  return sortRows(matched, query.sort, FILE_ACCESSORS)
}
