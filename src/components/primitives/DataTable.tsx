'use client'

// The shared admin list. Generic over the row type and driven entirely by props: it
// imports nothing from src/services and has never heard of Airtable. Column identity
// comes from the field registry (src/constants/fields.ts) and every cell renderer
// comes from the caller, which is what lets Abstracts, Sessions, Agenda List, and the
// portal admin lists be the same component rather than four near-copies. Most parity
// gaps in the reference project traced back to a missing shared primitive.
//
// Fully controlled: `rows` is the page the caller already sliced and `totalRows` is
// what the footer counts. Nothing here fetches, sorts, or filters, because on a table
// this wide the server is the only place those can happen without shipping the whole
// set to the browser.

import { type ReactNode, useState } from 'react'
import { DataTableFooter } from '@/components/primitives/DataTableFooter'
import { DataTableGrid } from '@/components/primitives/DataTableGrid'
import { DataTablePreferencesSheet } from '@/components/primitives/DataTablePreferences'
import { DataTableToolbar } from '@/components/primitives/DataTableToolbar'
import type {
  DataTableCatalog,
  DataTableColumn,
  DataTableDensity,
  DataTableFilter,
  DataTablePreferences,
  DataTableSort,
  DataTableTab,
  PreferenceTab,
} from '@/components/primitives/data-table-types'
import { DEFAULT_PAGE_SIZE, SESSION_CATALOG } from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/utils/cn'

export type DataTableProps<TRow> = {
  /** The current page, already sliced by the caller. */
  rows: readonly TRow[]
  rowId: (row: TRow) => string
  columns: readonly DataTableColumn<TRow>[]
  /**
   * Which slice of the field registry this surface is built over: the Columns picker's
   * catalog, the Sort and Filter panes' field list, and where a header's label and
   * tooltip come from. Defaults to the submission catalog, which is what every table
   * here read directly before the speaker CRM needed a second one.
   */
  catalog?: DataTableCatalog
  visibleColumnKeys: readonly string[]
  sort: DataTableSort | null
  filters: readonly DataTableFilter[]
  /**
   * The keys this surface can order and filter by.
   *
   * Omit and the Sort and Filter panes fall back to the catalog's own `queryableFields`
   * and no header is clickable, which is what every surface did before. Pass it and the
   * panes offer exactly these, drawn from the catalog's whole field list rather than from
   * its queryable slice, and their headers become sort controls. It is the caller's
   * to answer because the caller owns the accessors: the registry knows which fields have
   * an Airtable column behind them, which is a different question and the one that made
   * Ratings unsortable. See DataTableRules.
   */
  sortableKeys?: ReadonlySet<string>
  onPreferencesApply: (next: DataTablePreferences) => void

  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string

  /** Status tabs with live counts. Omit for a table with no tab strip. */
  tabs?: readonly DataTableTab[]
  activeTabId?: string
  onTabChange?: (id: string) => void
  /**
   * True while the rows for `activeTabId` are still being fetched.
   *
   * Only a surface with an OPTIMISTIC selection needs it. There, the strip has already moved
   * to the tab that was pressed, so the rows underneath are the previous tab's answer until
   * the read returns, and without this the table silently presents them as the new one.
   * Dims the body instead. A surface whose selection waits for its data passes nothing.
   */
  tabsPending?: boolean

  /** Omit both to render the table without row selection. */
  selectedIds?: readonly string[]
  onSelectionChange?: (ids: readonly string[]) => void

  page: number
  pageSize?: number
  totalRows: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void

  density?: DataTableDensity
  onDensityChange?: (density: DataTableDensity) => void

  /** Leading per-row controls, e.g. the pencil that opens the edit drawer. */
  rowActions?: (row: TRow) => ReactNode
  /**
   * The Saved Views control. Its own slot because the reference puts it BEFORE Columns /
   * Sort / Filter, and it needs the surface's stored views behind it.
   */
  toolbarViews?: ReactNode
  /** Toolbar controls that follow Filter: Drafts, Options, + Add, bulk actions. */
  toolbarExtra?: ReactNode
  emptyMessage?: string
  className?: string
}

export function DataTable<TRow>({
  rows,
  rowId,
  columns,
  catalog = SESSION_CATALOG,
  visibleColumnKeys,
  sort,
  filters,
  sortableKeys,
  onPreferencesApply,
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  tabs,
  activeTabId,
  onTabChange,
  tabsPending = false,
  selectedIds,
  onSelectionChange,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
  totalRows,
  onPageChange,
  onPageSizeChange,
  density = 'default',
  onDensityChange,
  rowActions,
  toolbarViews,
  toolbarExtra,
  emptyMessage = 'No rows found.',
  className,
}: DataTableProps<TRow>) {
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [preferencesTab, setPreferencesTab] = useState<PreferenceTab>('columns')

  // A key the caller gave no renderer for is dropped rather than rendered blank:
  // stored column preferences outlive any one surface's column set.
  const columnByKey = new Map(columns.map((column) => [column.key, column]))
  const ordered = visibleColumnKeys.flatMap((key) => {
    const column = columnByKey.get(key)
    return column === undefined ? [] : [column]
  })

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {tabs === undefined ? null : (
        <Tabs value={activeTabId} onValueChange={(next: string) => onTabChange?.(next)}>
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
                <Badge variant="secondary" className="tabular-nums">
                  {tab.count}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <DataTableToolbar
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        density={density}
        onDensityChange={(next) => onDensityChange?.(next)}
        onOpenPreferences={(tab) => {
          setPreferencesTab(tab)
          setPreferencesOpen(true)
        }}
        views={toolbarViews}
        extra={toolbarExtra}
      />

      {/* `aria-busy` alongside the dimming, because the visual cue is the only cue a
          sighted reader gets and a screen reader would otherwise be told nothing at all
          about rows that are about to be replaced. */}
      <div
        aria-busy={tabsPending}
        className={cn(
          // The transition lives on the base, not on the pending branch. Attached only
          // while pending, it faded the body OUT and then snapped it back at full
          // opacity the instant the rows arrived, which is the one moment the eye is
          // on it. Declared here, both directions ease.
          'rounded-xl border border-border bg-card transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
          tabsPending && 'pointer-events-none opacity-60',
        )}
      >
        <DataTableGrid
          rows={rows}
          rowId={rowId}
          columns={ordered}
          fields={catalog.fields}
          selectable={selectedIds !== undefined && onSelectionChange !== undefined}
          selection={new Set(selectedIds)}
          onSelectionChange={onSelectionChange}
          rowActions={rowActions}
          density={density}
          emptyMessage={emptyMessage}
          sort={sort}
          sortableKeys={sortableKeys}
          // A header click commits through the SAME path the Preferences drawer uses, so
          // the drawer and the header can never disagree about what the table is sorted
          // by, and a header sort is persisted by whatever the caller does with the rest
          // of its preferences rather than living in a second piece of state.
          onSortChange={(next) =>
            onPreferencesApply({ columnKeys: visibleColumnKeys, sort: next, filters })
          }
        />

        <DataTableFooter
          page={page}
          pageSize={pageSize}
          totalRows={totalRows}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>

      <DataTablePreferencesSheet
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        tab={preferencesTab}
        onTabChange={setPreferencesTab}
        preferences={{ columnKeys: visibleColumnKeys, sort, filters }}
        catalog={catalog}
        sortableKeys={sortableKeys}
        onApply={onPreferencesApply}
      />
    </div>
  )
}
