'use client'

// The per-speaker roll-up: one row per accepted speaker, kept alongside the per-deliverable
// table rather than replaced by it.
//
// It answers "how is the roster doing", which the pair table cannot at a glance, and it is the
// only view that lists a speaker of whom nothing has been requested at all: that person has no
// pairs and would otherwise vanish from a screen headed "Delivery status".
//
// Its Missing cell is now a way INTO the pair table for that one speaker, which is what the
// truncated `and N more` used to promise and not deliver.

import { useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type DeliveryRow, withMissingFiles } from '@/features/file-requests/delivery'

import {
  SPEAKER_DELIVERY_CATALOG,
  SPEAKER_DELIVERY_COLUMN_KEYS,
  speakerDeliveryColumns,
} from './delivery-columns'

export function SpeakerDeliveryTable({
  rows,
  onDrillDown,
}: {
  rows: readonly DeliveryRow[]
  /** Opens the per-deliverable table pinned to this speaker. */
  onDrillDown: (row: DeliveryRow) => void
}) {
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [columnKeys, setColumnKeys] = useState<readonly string[]>(SPEAKER_DELIVERY_COLUMN_KEYS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const needle = search.trim().toLowerCase()
  const filtered = (onlyMissing ? withMissingFiles(rows) : rows).filter(
    (row) => needle.length === 0 || `${row.name} ${row.email}`.toLowerCase().includes(needle),
  )
  const start = (page - 1) * pageSize

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Label className="flex items-center gap-2 self-end text-sm font-normal">
        <Switch
          checked={onlyMissing}
          onCheckedChange={(next) => {
            setOnlyMissing(next)
            setPage(1)
          }}
        />
        Has missing files
      </Label>

      <DataTable<DeliveryRow>
        rows={filtered.slice(start, start + pageSize)}
        rowId={(row) => row.speakerId}
        columns={speakerDeliveryColumns(onDrillDown)}
        catalog={SPEAKER_DELIVERY_CATALOG}
        visibleColumnKeys={columnKeys}
        sort={null}
        filters={[]}
        // The order is the roster order the server computed and the three columns are all this
        // roll-up has, so Columns is the only pane with anything to commit. It commits.
        onPreferencesApply={(next) => {
          setColumnKeys(next.columnKeys)
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search speakers..."
        page={page}
        pageSize={pageSize}
        totalRows={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={(next) => {
          setPageSize(next)
          setPage(1)
        }}
        emptyMessage={
          rows.length === 0
            ? 'No accepted speakers yet. Accept a submission to build the roster.'
            : 'No speakers match this filter.'
        }
      />
    </div>
  )
}
