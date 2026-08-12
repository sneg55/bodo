// Search, filter, sort, paginate, and the status tab counts, for the Abstracts view.
//
// It runs on the server. The DataTable primitive is fully controlled and states in
// its own header that nothing in it fetches, sorts, or filters, because on a table
// this wide the server is the only place those can happen without shipping the whole
// set to the browser. So this module is the other half of that contract.
//
// Sort and filter are offered over registry fields with `column: true` only
// (DataTableRules does the offering). This module therefore never has to reason
// about `answersJson`, which Airtable cannot sort or filter inside anyway.

import type {
  DataTableFilter,
  DataTableSort,
  DataTableTab,
} from '@/components/primitives/data-table-types'
import {
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from '@/constants/status'
import {
  hasNumericSort,
  rowNumber,
  rowText,
  rowValues,
  SEARCHABLE_KEYS,
} from '@/features/review/abstracts-accessors'
import type { AbstractRow } from '@/features/review/abstracts-rows'
import {
  matchesFilters,
  matchesSearch,
  pageRows,
  type RowAccessors,
  sortRows,
} from '@/features/views/table-query'

/**
 * The row-type-agnostic engine lives in table-query.ts. This is Abstracts' accessor
 * binding into it: the tab, track and status logic below is specific to this surface
 * and stays here.
 *
 * The accessors themselves moved to abstracts-accessors.ts, beside `SORTABLE_ROW_KEYS`,
 * which is the set the DataTable is told this surface can order by. That is the right
 * neighbour for them: the set and the accessors have to agree, and offering a key with
 * no accessor is exactly the bug the set exists to prevent.
 */
const ROW_ACCESSORS: RowAccessors<AbstractRow> = {
  text: rowText,
  numeric: hasNumericSort,
  number: rowNumber,
  searchableKeys: SEARCHABLE_KEYS,
  list: rowValues,
}

/** The "All Abstracts" tab id. Not a status, so it cannot collide with one. */
export const ALL_TAB_ID = 'all'

/**
 * Tab order, read off the product (docs/parity/abstracts-review.md): All Abstracts,
 * Accepted, Accept Queue, Pending, Decline Queue, Declined, Withdrawn, Drafts. It is
 * not the lifecycle order in `SUBMISSION_STATUSES`, which is why it is spelled out,
 * and every id here is checked against that vocabulary by the type.
 */
const TAB_ORDER: readonly SubmissionStatus[] = [
  'accepted',
  'accept_queue',
  'pending',
  'decline_queue',
  'declined',
  'withdrawn',
  'draft',
]

/**
 * The one label that differs from `SUBMISSION_STATUS_LABELS`: the tab strip reads
 * "Drafts" where a chip reads "Draft". Overridden rather than forked, so the chip
 * vocabulary stays the single source for everything else.
 */
const TAB_LABEL_OVERRIDES: ReadonlyMap<SubmissionStatus, string> = new Map([['draft', 'Drafts']])

const STATUS_LABELS: ReadonlyMap<SubmissionStatus, string> = new Map(
  Object.entries(SUBMISSION_STATUS_LABELS).map(([key, label]) => [key as SubmissionStatus, label]),
)

function tabLabel(status: SubmissionStatus): string {
  return TAB_LABEL_OVERRIDES.get(status) ?? STATUS_LABELS.get(status) ?? status
}

export function statusCounts(rows: readonly AbstractRow[]): ReadonlyMap<SubmissionStatus, number> {
  const counts = new Map<SubmissionStatus, number>(SUBMISSION_STATUSES.map((status) => [status, 0]))
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  }
  return counts
}

/**
 * Counts come from the whole event, not from the filtered set. A tab badge that
 * changed every time you typed in the search box would stop being a count of the
 * event and start being a count of the query, which is not what it is for.
 */
export function abstractTabs(
  rows: readonly AbstractRow[],
  /**
   * The leftmost tab's label. Defaulted to ref 19's wording, because Abstracts is the
   * surface the screenshots capture; View All and Sessions pass their own
   * (`features/review/submission-scope.ts`). The COUNTS are already scoped, because the
   * caller filters the rows to its surface before it gets here.
   */
  allTabLabel = 'All Abstracts',
): readonly DataTableTab[] {
  const counts = statusCounts(rows)
  return [
    { id: ALL_TAB_ID, label: allTabLabel, count: rows.length },
    ...TAB_ORDER.map((status) => ({
      id: status,
      label: tabLabel(status),
      count: counts.get(status) ?? 0,
    })),
  ]
}

function matchesTab(row: AbstractRow, tabId: string): boolean {
  return tabId === ALL_TAB_ID || row.status === tabId
}

export type AbstractQuery = {
  readonly tabId: string
  readonly search: string
  readonly filters: readonly DataTableFilter[]
  readonly sort: DataTableSort | null
  /**
   * The toolbar's Track dropdown. Kept separate from `filters` and matched on the
   * track's RECORD ID rather than its name: a track renamed mid-cycle would otherwise
   * silently empty a filtered view, and Track is the review category that routing and
   * reviewer assignment both key on (schema section 3).
   */
  readonly trackId?: string
}

function matchesTrack(row: AbstractRow, trackId: string | undefined): boolean {
  return trackId === undefined || trackId.length === 0 || row.track?.id === trackId
}

export function filterAbstractRows(
  rows: readonly AbstractRow[],
  query: AbstractQuery,
): readonly AbstractRow[] {
  return rows.filter(
    (row) =>
      matchesTab(row, query.tabId) &&
      matchesTrack(row, query.trackId) &&
      matchesSearch(row, query.search, ROW_ACCESSORS) &&
      matchesFilters(row, query.filters, ROW_ACCESSORS),
  )
}

/**
 * Missing values sort last in BOTH directions.
 *
 * Deliberate: an organizer sorting Ratings descending is looking for the strongest
 * submissions; an organizer sorting ascending is looking for the weakest. In neither
 * case are they looking for the forty rows nobody has reviewed. The comparator that
 * enforces this lives in table-query.ts; this is the value it compares on.
 */
export function sortValue(row: AbstractRow, key: string): number | string | undefined {
  if (hasNumericSort(key)) return rowNumber(row, key)
  const text = rowText(row, key) ?? ''
  return text.length === 0 ? undefined : text
}

export function sortAbstractRows(
  rows: readonly AbstractRow[],
  sort: DataTableSort | null,
): readonly AbstractRow[] {
  return sortRows(rows, sort, ROW_ACCESSORS)
}

export type AbstractPage = {
  readonly rows: readonly AbstractRow[]
  readonly totalRows: number
  /** Clamped, so a stale page number cannot render an empty table for no reason. */
  readonly page: number
}

export function pageAbstractRows(
  rows: readonly AbstractRow[],
  page: number,
  pageSize: number,
): AbstractPage {
  return pageRows(rows, page, pageSize)
}
