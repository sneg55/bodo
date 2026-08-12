'use client'

// Optional companion to DataTable. The table is deliberately fully controlled, which
// is right for a server-driven list but means twenty props at the call site; this
// holds the ones a caller almost never wants to own itself.
//
// Page resets to 1 whenever the result set changes underneath it (new search, new
// tab, new page size). Without that, changing a filter can land you on page 4 of a
// two-page list and the table looks empty for no visible reason.

import { useState } from 'react'
import {
  type DataTableDensity,
  type DataTableFilter,
  type DataTablePreferences,
  type DataTableSort,
  DEFAULT_PAGE_SIZE,
} from '@/components/primitives/data-table-types'
import { DEFAULT_COLUMN_KEYS } from '@/constants/fields'

export type UseDataTableStateOptions = {
  initialColumnKeys?: readonly string[]
  /**
   * The sort and filters to open with, for a surface whose default saved view supplies
   * them. Initial values only: they seed `useState` and a later change to the prop does
   * nothing, which is what keeps applying a view a single explicit action rather than a
   * prop the table keeps re-reading.
   */
  initialSort?: DataTableSort | null
  initialFilters?: readonly DataTableFilter[]
  initialTabId?: string
  initialPageSize?: number
  initialDensity?: DataTableDensity
}

export function useDataTableState({
  initialColumnKeys = DEFAULT_COLUMN_KEYS,
  initialSort = null,
  initialFilters = [],
  initialTabId,
  initialPageSize = DEFAULT_PAGE_SIZE,
  initialDensity = 'default',
}: UseDataTableStateOptions = {}) {
  const [search, setSearch] = useState('')
  const [activeTabId, setActiveTabId] = useState(initialTabId)
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<readonly string[]>(initialColumnKeys)
  const [sort, setSort] = useState<DataTableSort | null>(initialSort)
  const [filters, setFilters] = useState<readonly DataTableFilter[]>(initialFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [density, setDensity] = useState<DataTableDensity>(initialDensity)

  const applyPreferences = (next: DataTablePreferences) => {
    setVisibleColumnKeys(next.columnKeys)
    setSort(next.sort)
    setFilters(next.filters)
    setPage(1)
  }

  return {
    search,
    onSearchChange: (value: string) => {
      setSearch(value)
      setPage(1)
    },
    activeTabId,
    onTabChange: (id: string) => {
      setActiveTabId(id)
      // Selection is per result set: keeping ticked rows from the Pending tab
      // while looking at Declined is how a bulk action hits the wrong records.
      setSelectedIds([])
      setPage(1)
    },
    selectedIds,
    onSelectionChange: setSelectedIds,
    visibleColumnKeys,
    sort,
    filters,
    onPreferencesApply: applyPreferences,
    page,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: (next: number) => {
      setPageSize(next)
      setPage(1)
    },
    density,
    onDensityChange: setDensity,
  }
}
