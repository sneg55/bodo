'use client'

// Section 3: Sync log. Newest first, paginated, with the error on a failure.
//
// This section is AUTHORED. Sessionboard documents eight integrations and none of them has
// a log surface: their articles route a sync failure to support with the event name and a
// screenshot of the error. So there is nothing to clone here, and it is kept anyway,
// because bodo's outbox-and-claim design makes a failed row inspectable and hiding that
// behind "contact support" would be copying a weakness. The heading above this table says
// so on the page, not only in this comment.
//
// This is the one table on the page that grows WITHOUT BOUND: every attempt writes a row,
// including a skip. So it pages through the `DataTable` footer rather than rendering the
// whole list, and it is sorted by the DAL rather than here (`listEventSyncLogs` asks
// Airtable for `at desc`), because the row an organizer wants is the one just written.
//
// The status chip goes through `statusChipVariants`, the cva the shared `StatusChip`
// exports, and NOT through the component itself. `StatusChip` renders the seven-state
// submission lifecycle and takes a `SubmissionStatus`, so passing it `accepted` to colour
// an `ok` row would print the word "Accepted" over a sync result. Reusing the variant layer
// keeps one palette for "this went well / this did not" without lying about the label.

import { useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import { type DataTableColumn, DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { statusChipVariants } from '@/components/primitives/StatusChip'
import { Badge } from '@/components/ui/badge'
import type { SyncLogRowModel } from '@/features/integrations/reads'
import { cn } from '@/utils/cn'

const COLUMNS: readonly DataTableColumn<SyncLogRowModel>[] = [
  {
    key: 'log-status',
    label: 'Status',
    help: 'Whether Accelevents accepted the attempt. A skip is still an ok: it means the payload matched what was last accepted, so nothing was sent.',
    cell: (row) => (
      <Badge
        variant="outline"
        className={cn(
          statusChipVariants({ status: row.status === 'ok' ? 'accepted' : 'declined' }),
        )}
      >
        {row.status === 'ok' ? 'OK' : 'Failed'}
      </Badge>
    ),
  },
  {
    key: 'log-entity',
    label: 'Entity',
    help: 'What was being sent: a session, a speaker, or a piece of taxonomy.',
    cell: (row) => row.entityLabel,
  },
  {
    key: 'log-local',
    label: 'Local record',
    help: 'The bodo record the attempt was for. A record id here rather than a name means the record has since been deleted.',
    cell: (row) => <span className="truncate">{row.localLabel}</span>,
  },
  {
    key: 'log-action',
    label: 'Action',
    help: 'Create, Update, or Skip. A skip is written on purpose: it is the record that the payload was unchanged, which is what stops a re-sync sending everything again.',
    cell: (row) => row.actionLabel,
  },
  {
    key: 'log-at',
    label: 'When',
    help: "When the attempt was made, in the event's timezone.",
    cell: (row) => row.atText,
  },
  {
    key: 'log-error',
    label: 'Error',
    help: 'The message the attempt failed with, as recorded. This is the row the vendor’s own product would have sent you to support with.',
    cell: (row) =>
      row.error === undefined ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        <span className="text-destructive">{row.error}</span>
      ),
  },
]

const COLUMN_KEYS = COLUMNS.map((column) => column.key)

export function AccelSyncLogTable({
  rows,
  configured,
}: {
  rows: readonly SyncLogRowModel[]
  configured: boolean
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const needle = search.trim().toLowerCase()
  const filtered = rows.filter((row) => needle === '' || searchText(row).includes(needle))
  const start = (page - 1) * pageSize

  return (
    <DataTable<SyncLogRowModel>
      rows={filtered.slice(start, start + pageSize)}
      rowId={(row) => row.id}
      columns={COLUMNS}
      visibleColumnKeys={COLUMN_KEYS}
      sort={null}
      filters={[]}
      onPreferencesApply={() => undefined}
      search={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder="Search the sync log..."
      page={page}
      pageSize={pageSize}
      totalRows={filtered.length}
      onPageChange={setPage}
      onPageSizeChange={(next) => {
        setPageSize(next)
        setPage(1)
      }}
      emptyMessage={emptyMessage(configured, needle !== '')}
    />
  )
}

function searchText(row: SyncLogRowModel): string {
  return `${row.entityLabel} ${row.localLabel} ${row.actionLabel} ${row.error ?? ''}`.toLowerCase()
}

/**
 * Empty means one of two different things, and they are fixed in different places.
 *
 * An empty log on a CONFIGURED integration is the healthy resting state of an event nobody
 * has synced yet, not a failure to record anything. An empty log on an unconfigured one is
 * a consequence of the missing key, and pointing that reader at `Sync now` would have them
 * press a button that cannot work.
 */
function emptyMessage(configured: boolean, searching: boolean): string {
  if (searching) return 'No log rows match this search.'
  return configured
    ? 'Nothing has been sent to Accelevents yet, so there is nothing to log. Every attempt writes a row here, including the ones that change nothing.'
    : 'This integration is not configured, so no attempt has been made. See Connection above for what is missing.'
}
