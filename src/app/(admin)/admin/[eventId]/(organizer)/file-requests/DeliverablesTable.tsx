'use client'

// The per-deliverable table: one row per (speaker, requested document). CNT-07.
//
// This is the answer to the criterion the aggregate could not give. A speaker owes several
// documents with several deadlines, so a single row per speaker has one delivered fraction and
// nowhere to put a due date; a row per pair carries its own status, its own deadline, and its
// own session when the request is owed once per session.
//
// Everything the toolbar offers is wired, which is the other half of the fix:
//
//   - the status tabs filter, and `Overdue` is a subset of `Outstanding` on purpose;
//   - Columns offers THIS table's seven columns and applying a selection changes the table;
//   - Sort and Filter run over the same accessors, so a deadline orders by its instant;
//   - the drill-down from the By speaker tab pins one person, with a control to release it.
//
// Search, filter, sort and paging are LOCAL state, as they are on the Files list and for the
// same reason: the server has already scoped these rows to the event and the whole set is in
// this page's payload, so a URL round trip would buy nothing.

import { useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import type {
  DataTableDensity,
  DataTableFilter,
  DataTableSort,
} from '@/components/primitives/data-table-types'
import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import {
  DELIVERABLE_CATALOG,
  DELIVERABLE_DEFAULT_COLUMN_KEYS,
  DELIVERABLE_FIELDS,
  queryDeliverables,
} from '@/features/files/deliverable-query'
import {
  type DeliverableRow,
  type DeliverableTab,
  deliverableTabs,
} from '@/features/files/deliverables'
import { pageRows } from '@/features/views/table-query'

import { DELIVERABLE_COLUMNS } from './delivery-columns'

/** Every column this table renders can be ordered and filtered, because all of them are derived. */
const SORTABLE_KEYS = new Set(DELIVERABLE_FIELDS.map((field) => field.key))

export function DeliverablesTable({
  rows,
  focus,
  onClearFocus,
}: {
  rows: readonly DeliverableRow[]
  /** The speaker pinned by the By speaker tab's drill-down, if any. */
  focus: { id: string; name: string } | null
  onClearFocus: () => void
}) {
  const [tab, setTab] = useState<DeliverableTab>('all')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<readonly DataTableFilter[]>([])
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [columnKeys, setColumnKeys] = useState<readonly string[]>(DELIVERABLE_DEFAULT_COLUMN_KEYS)
  const [density, setDensity] = useState<DataTableDensity>('default')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const matched = queryDeliverables(rows, {
    tab,
    search,
    filters,
    sort,
    ...(focus === null ? {} : { speakerId: focus.id }),
  })
  const paged = pageRows(matched, page, pageSize)

  return (
    <DataTable<DeliverableRow>
      rows={paged.rows}
      rowId={(row) => row.id}
      columns={DELIVERABLE_COLUMNS}
      catalog={DELIVERABLE_CATALOG}
      visibleColumnKeys={columnKeys}
      sort={sort}
      filters={filters}
      sortableKeys={SORTABLE_KEYS}
      onPreferencesApply={(next) => {
        setColumnKeys(next.columnKeys)
        setSort(next.sort)
        setFilters(next.filters)
        setPage(1)
      }}
      tabs={deliverableTabs(rows)}
      activeTabId={tab}
      onTabChange={(id) => {
        setTab(id as DeliverableTab)
        setPage(1)
      }}
      search={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder="Search speakers or documents..."
      toolbarExtra={
        focus === null ? null : (
          // Says whose list this is and gets out of it. A pinned table that looked like the
          // whole table would read as rows having gone missing.
          <Button variant="outline" size="sm" onClick={onClearFocus}>
            {`Showing ${focus.name} only. Show everyone`}
          </Button>
        )
      }
      density={density}
      onDensityChange={setDensity}
      page={paged.page}
      pageSize={pageSize}
      totalRows={paged.totalRows}
      onPageChange={setPage}
      onPageSizeChange={(next) => {
        setPageSize(next)
        setPage(1)
      }}
      emptyMessage={
        rows.length === 0
          ? 'Nothing has been requested yet. Create a file request and assign it to the accepted speakers.'
          : 'No deliverables match this filter.'
      }
    />
  )
}
