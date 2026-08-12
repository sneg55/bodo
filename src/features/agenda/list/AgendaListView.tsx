'use client'

import { useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import { useDataTableState } from '@/components/primitives/use-data-table-state'
import { Button } from '@/components/ui/button'
import { DEFAULT_COLUMN_KEYS } from '@/constants/fields'
import { SavedViewsControl } from '@/features/views/SavedViewsControl'
import { applySavedView, defaultSavedView } from '@/features/views/saved-view-model'
import { AGENDA_LIST_SURFACE, type SavedView } from '@/types/saved-views'
import { cn } from '@/utils/cn'
import { AgendaEmptyState } from '../AgendaEmptyState'
import type { ConflictReport } from '../conflicts'
import { contentApprovalRequired, publicAgendaRows } from '../public-agenda'
import type { AgendaData, AgendaSession, ScheduleRequest } from '../types'
import { AddSessionSheet } from './AddSessionSheet'
import { DraftsControl, OptionsControl } from './AgendaListControls'
import { AgendaRowActions } from './AgendaRowActions'
import { agendaColumns, visibilityOf } from './agenda-cells'
import { agendaCsv, applyAgendaList } from './list-model'

export function AgendaListView({
  data,
  report,
  isPending,
  savedViews,
  canEdit,
  onSchedule,
  onPublication,
}: {
  data: AgendaData
  report: ConflictReport
  isPending: boolean
  /** The event's persisted views for the `sessions` surface. */
  savedViews: readonly SavedView[]
  /** Only an admin may write a view. A reviewer may still apply one. */
  canEdit: boolean
  onSchedule: (change: ScheduleRequest) => void
  onPublication: (submissionIds: readonly string[], published: boolean) => void
}) {
  // The surface opens on the default view when there is one. Every bit of this list's state
  // is client state, so unlike Abstracts (which keeps its query in the URL and applies the
  // default on the server) seeding the hook is the whole implementation.
  const opening = defaultSavedView(savedViews)
  const table = useDataTableState({
    initialColumnKeys:
      opening === undefined || opening.columnKeys.length === 0 ? undefined : opening.columnKeys,
    initialSort: opening?.sort ?? null,
    initialFilters: opening === undefined ? [] : applySavedView(opening).filters,
  })
  const [draftsOnly, setDraftsOnly] = useState(false)
  // Which stored view the toolbar shows as picked. The state it restored lives in the
  // table's own columns/sort/filters, so this is only the menu's mark.
  const [appliedViewId, setAppliedViewId] = useState<string | null>(opening?.id ?? null)
  const rows = applyAgendaList(data.sessions, {
    search: table.search,
    draftsOnly,
    sort: table.sort,
    filters: table.filters,
    timeZone: data.event.timezone,
  })
  const start = (table.page - 1) * table.pageSize
  const pageRows = rows.slice(start, start + table.pageSize)
  const selected = new Set(table.selectedIds)
  const selectedRows = data.sessions.filter((session) => selected.has(session.id))
  const canPublishSelection =
    selectedRows.length > 0 &&
    selectedRows.every((session) => session.scheduleStatus !== 'unscheduled')
  const canUnpublishSelection = selectedRows.some(
    (session) => session.scheduleStatus === 'published',
  )
  // Which mode the content gate is in, derived from the candidate set exactly as the public
  // read derives it (public-agenda.ts). Without it every row here answered in the permissive
  // mode, so a `Not submitted` session on an agenda that HAS approvals read as published and
  // live while the public page withheld it.
  const requireContentApproval = contentApprovalRequired(
    publicAgendaRows(data.sessions.map(visibilityOf)),
  )
  const columns = agendaColumns(data.event.id, data.event.timezone, report, requireContentApproval)

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        rows={pageRows}
        rowId={(row) => row.id}
        columns={columns}
        visibleColumnKeys={table.visibleColumnKeys}
        sort={table.sort}
        filters={table.filters}
        onPreferencesApply={table.onPreferencesApply}
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search sessions..."
        selectedIds={table.selectedIds}
        onSelectionChange={table.onSelectionChange}
        page={table.page}
        pageSize={table.pageSize}
        totalRows={rows.length}
        onPageChange={table.onPageChange}
        onPageSizeChange={table.onPageSizeChange}
        density={table.density}
        onDensityChange={table.onDensityChange}
        rowActions={(session) => (
          <AgendaRowActions
            eventId={data.event.id}
            session={session}
            rooms={data.rooms}
            timeZone={data.event.timezone}
            isPending={isPending}
            onSchedule={onSchedule}
            onPublication={onPublication}
          />
        )}
        toolbarViews={
          <SavedViewsControl
            eventId={data.event.id}
            surface={AGENDA_LIST_SURFACE}
            views={savedViews}
            current={{
              columnKeys: table.visibleColumnKeys,
              sort: table.sort,
              filters: table.filters,
            }}
            appliedId={appliedViewId}
            canEdit={canEdit}
            onApply={(view) => {
              setAppliedViewId(view?.id ?? null)
              // Picking "All records" restores the surface's own default set rather than
              // leaving the last view's columns behind pretending nothing is applied.
              table.onPreferencesApply(
                view === null
                  ? { columnKeys: [...DEFAULT_COLUMN_KEYS], sort: null, filters: [] }
                  : applySavedView(view),
              )
            }}
          />
        }
        toolbarExtra={
          <>
            {selectedRows.length === 0 ? null : (
              <>
                <Button
                  variant="outline"
                  disabled={isPending || !canUnpublishSelection}
                  onClick={() => onPublication(table.selectedIds, false)}
                >
                  Unpublish selected
                </Button>
                <Button
                  variant="secondary"
                  disabled={isPending || !canPublishSelection}
                  onClick={() => onPublication(table.selectedIds, true)}
                >
                  Publish selected
                </Button>
              </>
            )}
            <DraftsControl
              active={draftsOnly}
              onClick={() => {
                setDraftsOnly((current) => !current)
                table.onPageChange(1)
              }}
            />
            <OptionsControl onExport={() => downloadCsv(rows, data.event.timezone)} />
            <AddSessionSheet eventId={data.event.id} speakers={data.speakers} />
          </>
        }
        emptyMessage="No sessions match this view."
        className={cn(data.sessions.length === 0 && '[&>div:nth-child(2)]:hidden')}
      />
      {data.sessions.length === 0 ? <AgendaEmptyState /> : null}
    </div>
  )
}

function downloadCsv(sessions: readonly AgendaSession[], timeZone: string): void {
  const url = URL.createObjectURL(new Blob([agendaCsv(sessions, timeZone)], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'agenda.csv'
  link.click()
  URL.revokeObjectURL(url)
}
