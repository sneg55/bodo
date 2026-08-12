'use client'

// The two admin Files lists: SUBMISSIONS > Files and PORTALS > Files.
//
// One component behind both, because they are two scopes over one table (file-rows.ts) and
// an organizer should not have to learn two layouts to read the same rows. The two scopes
// OVERLAP on a requested document filed against a session, which is why the Session column
// is shown on both: the portal list can have one now.
//
// Built on the shared DataTable primitive, like the Tasks and File Requests lists, so the
// toolbar, density, footer and empty state behave as they do on every admin list. Its cells
// and its column catalog are in files-columns.tsx; its search, filter and sort are in
// files-query.ts. Both were split out when the Columns picker was fixed: the drawer here
// offered the SESSION registry's 22 fields over a table of FILES and committed nothing back.
//
// Search, filtering and paging are LOCAL state here, unlike Abstracts. That surface keeps
// its query in the URL because the server does the work on a table 39 columns wide; this
// one is a handful of columns over a list the server has already scoped to the event, so the
// whole set is in the browser already and a URL round trip would buy nothing.
//
// Neither list is captured in any screenshot: the sidebar shows both entries and nothing
// behind them. So the columns are the ones the data can actually answer, and no copy here
// claims to be transcribed.

import { DownloadIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import type { DataTableFilter, DataTableSort } from '@/components/primitives/data-table-types'
import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileBundleDialog } from '@/features/bundle/FileBundleDialog'
import type { FileScope } from '@/features/files/file-rows'
import { FILES_CATALOG, FILES_COLUMN_KEYS, fileColumns } from '@/features/files/files-columns'
import { FILE_QUERYABLE_KEYS, queryFiles } from '@/features/files/files-query'
import type { FilesView } from '@/features/files/reads'
import { pageRows } from '@/features/views/table-query'

export type FilesTableProps = {
  view: FilesView
  scope: FileScope
  eventId: string
}

export function FilesTable({ view, scope, eventId }: FilesTableProps) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<readonly DataTableFilter[]>([])
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [columnKeys, setColumnKeys] = useState<readonly string[]>(FILES_COLUMN_KEYS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  // Ticked rows, and the archive built out of them. Selection survives paging and searching
  // on purpose: an organizer collecting one deck per track filters, ticks, filters again, and
  // a set that emptied itself on every keystroke would make that impossible.
  const [selected, setSelected] = useState<readonly string[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  // Memoized because the dialog reads on a `source` effect. An inline object literal would be
  // a fresh identity on every render, the effect would refire, its `setState` would render
  // again, and the dialog would read in a loop for as long as it stayed open.
  const exportSource = useMemo(() => ({ kind: 'files' as const, fileIds: selected }), [selected])

  const matched = queryFiles(view.rows, { search, filters, sort })
  const paged = pageRows(matched, page, pageSize)

  return (
    <DataTable
      rows={paged.rows}
      rowId={(row) => row.id}
      columns={fileColumns(eventId)}
      catalog={FILES_CATALOG}
      visibleColumnKeys={columnKeys}
      sort={sort}
      filters={filters}
      sortableKeys={FILE_QUERYABLE_KEYS}
      onPreferencesApply={(next) => {
        setColumnKeys(next.columnKeys)
        setSort(next.sort)
        setFilters(next.filters)
        setPage(1)
      }}
      search={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder="Search files..."
      selectedIds={selected}
      onSelectionChange={setSelected}
      toolbarExtra={
        <>
          <Button
            size="sm"
            className="hit-area-y"
            disabled={selected.length === 0}
            onClick={() => setExportOpen(true)}
          >
            {/* `data-icon="inline-start"` is what trips the Button's own optical padding
                (`has-data-[icon=inline-start]:pl-1.5` at this size), so the leading icon
                sits closer to the edge than the trailing text and the label reads centred.
                Same attribute and same reason as the toolbar's Columns/Sort/Filter. */}
            <DownloadIcon data-icon="inline-start" />
            Export
            {selected.length === 0 ? null : <Badge variant="secondary">{selected.length}</Badge>}
          </Button>
          {/* Mounted only while open, so each opening starts from a fresh read with nothing
              deselected. See the note at the top of FileBundleDialog. */}
          {exportOpen ? (
            <FileBundleDialog
              eventId={eventId}
              source={exportSource}
              onOpenChange={setExportOpen}
            />
          ) : null}
        </>
      }
      page={paged.page}
      pageSize={pageSize}
      totalRows={paged.totalRows}
      onPageChange={setPage}
      onPageSizeChange={(next) => {
        setPageSize(next)
        setPage(1)
      }}
      emptyMessage={emptyMessage(view, scope, search.trim().length > 0)}
    />
  )
}

/**
 * An empty list says where the files went, when the other list has some. "No files yet" on
 * a screen whose sibling holds forty is the sentence that sends an organizer looking for a
 * bug in the upload path.
 */
function emptyMessage(view: FilesView, scope: FileScope, searching: boolean): string {
  if (searching) return 'No files match this search.'

  if (scope === 'submissions') {
    return view.totals.portal > 0
      ? `No files are attached to a submission yet. ${countLabel(view.totals.portal)} in Portals > Files.`
      : 'No files have been uploaded yet.'
  }

  return view.totals.submissions > 0
    ? `No headshots or requested documents yet. ${countLabel(view.totals.submissions)} attached to submissions.`
    : 'No files have been uploaded yet.'
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? 'file is' : 'files are'}`
}
