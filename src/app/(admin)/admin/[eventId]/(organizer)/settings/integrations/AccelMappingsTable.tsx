'use client'

// Section 2: Mappings. The table that answers "did it actually land".
//
// One row per local record that has a remote counterpart, so this is the only place an
// organizer can see that a session exists on the far side without opening Accelevents.
//
// Through the shared `DataTable`, like every other admin list, which is what buys the
// toolbar, the density control, the paging footer and the per-header info tooltip without
// a fourth hand-written table. Search and paging are LOCAL state: the rows are one event's
// mappings, already in the browser, so a URL round trip would buy nothing.
//
// THE EMPTY STATE IS THE POINT OF THIS COMPONENT'S PROPS. Before the forward sync landed,
// nothing in this codebase ever wrote a first mapping row, so an empty table was the
// correct render for a perfectly healthy integration. "Not configured" and "nothing has
// synced yet" are different problems with different fixes, and a single "No rows found."
// would send an organizer to look for the wrong one.

import Link from 'next/link'
import { useState } from 'react'
import { ButtonLink } from '@/components/primitives/ButtonLink'
import { DataTable } from '@/components/primitives/DataTable'
import { type DataTableColumn, DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import type { MappingRow } from '@/features/integrations/reads'

const COLUMNS: readonly DataTableColumn<MappingRow>[] = [
  {
    key: 'mapping-entity',
    label: 'Entity',
    help: 'What kind of record this is on bodo’s side: a session, a speaker, or a piece of taxonomy.',
    cell: (row) => row.entityLabel,
  },
  {
    key: 'mapping-local',
    label: 'Local record',
    help: 'The bodo record. Linked to the list that holds it; speakers have no admin list in this build, so those are shown without a link rather than with a dead one.',
    cell: (row) =>
      row.localHref === undefined ? (
        <span className="truncate">{row.localLabel}</span>
      ) : (
        <ButtonLink href={row.localHref} variant="link" size="sm" className="h-auto px-0">
          {row.localLabel}
        </ButtonLink>
      ),
  },
  {
    key: 'mapping-remote',
    label: 'Remote id',
    help: 'The id on the provider’s side, exactly as stored. Ids are namespaced by source (sessionize:14022) so two providers cannot collide on the same integer; an unprefixed id is an Accelevents row written before that namespacing landed.',
    cell: (row) => <span className="font-mono text-xs">{row.remoteId}</span>,
  },
  {
    key: 'mapping-synced',
    label: 'Synced at',
    help: "When this mapping was last written, in the event's timezone.",
    cell: (row) => row.syncedText,
  },
]

const COLUMN_KEYS = COLUMNS.map((column) => column.key)

export function AccelMappingsTable({
  rows,
  configured,
}: {
  rows: readonly MappingRow[]
  configured: boolean
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const needle = search.trim().toLowerCase()
  const filtered = rows.filter((row) => needle === '' || searchText(row).includes(needle))
  const start = (page - 1) * pageSize

  return (
    <DataTable<MappingRow>
      rows={filtered.slice(start, start + pageSize)}
      rowId={(row) => row.id}
      columns={COLUMNS}
      visibleColumnKeys={COLUMN_KEYS}
      sort={null}
      filters={[]}
      // The column set is fixed and the order is the DAL's, so the preferences drawer has
      // nothing to commit. The same call FilesTable and DeliveryStatus make.
      onPreferencesApply={() => undefined}
      search={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder="Search mappings..."
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

function searchText(row: MappingRow): string {
  return `${row.entityLabel} ${row.localLabel} ${row.remoteId}`.toLowerCase()
}

function emptyMessage(configured: boolean, searching: boolean): string {
  if (searching) return 'No mappings match this search.'
  return configured
    ? 'Nothing has synced yet. Press Sync now below to send this event’s accepted sessions and their speakers.'
    : 'This integration is not configured, so nothing has been sent. See Connection above for what is missing.'
}
