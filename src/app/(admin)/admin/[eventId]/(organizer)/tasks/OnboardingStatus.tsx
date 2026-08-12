'use client'

// The onboarding status view: one row per accepted speaker, `Progress` plus `n/m`.
//
// This is the surface SPEC.md R6's acceptance criterion names, and it is deliberately a
// table and not a chart. SPEC.md line 44 defers dashboard analytics and charts, and
// BUILD_SPEC 5.6's "matrix speakers x tasks" would be a column per task, which stops fitting
// at the fourth task and answers a question nobody asked: what an organizer wants here is who
// to chase, which is a sort on outstanding.
//
// Built on the shared DataTable primitive rather than a local table, so the toolbar, density,
// column preferences, footer and empty state behave the way every other admin list does.
// Columns carry an explicit `label` because none of these keys is in the field registry
// (src/constants/fields.ts), which describes session and participant fields.
//
// Paging, search and the outstanding filter are LOCAL state, not URL state, and that is the
// opposite of AbstractsTable's choice for a reason: the whole roster is already in this
// page's payload (one row per accepted speaker, not a table of thousands), so pushing a query
// string would cost a server round trip to filter data the browser is holding.

import { useMemo, useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import type { DataTableColumn } from '@/components/primitives/data-table-types'
import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Progress, ProgressValue } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import type { SpeakerProgressRow } from '@/features/tasks/progress'
import { withOutstanding } from '@/features/tasks/progress'

import { ProgressPoller } from './ProgressPoller'
import { RemindOutstandingButton } from './RemindOutstandingButton'
import { ViewPortalAsSpeaker } from './ViewPortalAsSpeaker'

const COLUMNS: readonly DataTableColumn<SpeakerProgressRow>[] = [
  {
    key: 'speaker',
    label: 'Speaker',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground">{row.email}</span>
      </div>
    ),
  },
  {
    key: 'progress',
    label: 'Progress',
    cellClassName: 'w-56',
    cell: (row) => (
      // `aria-label` because the primitive's own `aria-valuetext` is a percentage, so a
      // screen reader announced "33%" where the sighted label reads `1/3`.
      <Progress value={row.percent} className="min-w-40" aria-label={`${row.name}: ${row.label}`}>
        {/* The `n/m` the acceptance criterion names, rendered from the server-computed
            label rather than from `value`, so the bar and the number cannot disagree.
            `ProgressValue` takes a render function, not a node. */}
        <ProgressValue>{() => row.label}</ProgressValue>
      </Progress>
    ),
  },
  {
    key: 'outstanding',
    label: 'Outstanding',
    cell: (row) =>
      row.assigned === 0 ? (
        <span className="text-muted-foreground">No tasks assigned</span>
      ) : row.outstanding === 0 ? (
        <Badge variant="secondary">Complete</Badge>
      ) : (
        // Capped at two titles. Listing all of them pushed the row past the card on a
        // speaker owing seven tasks, and the table's job here is who to chase, not a full
        // manifest: the count carries the rest.
        <span className="text-sm">{outstandingSummary(row.outstandingTitles)}</span>
      ),
  },
]

const OUTSTANDING_SHOWN = 2

function outstandingSummary(titles: readonly string[]): string {
  const shown = titles.slice(0, OUTSTANDING_SHOWN).join(', ')
  const rest = titles.length - OUTSTANDING_SHOWN
  return rest > 0 ? `${shown} and ${rest} more` : shown
}

/**
 * The three columns above plus the impersonation entry, which needs the event id and so
 * cannot be a module constant. `label` is set because `portal` is not a registry field.
 */
function columnsFor(
  eventId: string,
  canImpersonate: boolean,
): readonly DataTableColumn<SpeakerProgressRow>[] {
  return [
    ...COLUMNS,
    {
      key: 'portal',
      label: 'Portal',
      cellClassName: 'w-32',
      cell: (row) => (
        <ViewPortalAsSpeaker
          eventId={eventId}
          speakerId={row.speakerId}
          name={row.name}
          disabled={!canImpersonate}
        />
      ),
    },
  ]
}

export function OnboardingStatus({
  rows,
  totals,
  eventId,
  canImpersonate,
}: {
  rows: readonly SpeakerProgressRow[]
  totals: { speakers: number; assigned: number; done: number; complete: number }
  eventId: string
  /** False for a reviewer, who may read this board but may not act as a speaker. */
  canImpersonate: boolean
}) {
  const columns = useMemo(() => columnsFor(eventId, canImpersonate), [eventId, canImpersonate])
  const [search, setSearch] = useState('')
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const needle = search.trim().toLowerCase()
  const filtered = (onlyOutstanding ? withOutstanding(rows) : rows).filter(
    (row) => needle.length === 0 || `${row.name} ${row.email}`.toLowerCase().includes(needle),
  )
  const start = (page - 1) * pageSize

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {/* Polls only while something is still outstanding.

          It polled unconditionally, so a fully onboarded roster kept firing an RSC request
          every ten seconds forever, and each one is a full server render of a page with
          several Airtable-backed reads behind it. The page also never reached network idle,
          which is what a browser, a test harness and an automation agent all wait for: a
          settled screen looked like a screen still loading. */}
      <ProgressPoller enabled={totals.done < totals.assigned} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">Onboarding status</h2>
          <p className="text-sm text-muted-foreground">
            {totals.speakers} accepted {totals.speakers === 1 ? 'speaker' : 'speakers'},{' '}
            {totals.done} of {totals.assigned} tasks done, {totals.complete} fully onboarded
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Switch
              checked={onlyOutstanding}
              onCheckedChange={(next) => {
                setOnlyOutstanding(next)
                setPage(1)
              }}
            />
            Has outstanding
          </Label>
          {/* CNT-08. Beside the filter that names the same set, so the control and the way to
              see who it targets sit together. These ids are what this table computed; the
              action recomputes who is behind server-side and treats them as a filter, so a
              speaker who finished their last task since the page loaded drops out. */}
          <RemindOutstandingButton
            eventId={eventId}
            speakerIds={withOutstanding(rows).map((row) => row.speakerId)}
            disabled={!canImpersonate}
          />
        </div>
      </div>

      <DataTable
        rows={filtered.slice(start, start + pageSize)}
        rowId={(row) => row.speakerId}
        columns={columns}
        visibleColumnKeys={columns.map((column) => column.key)}
        sort={null}
        filters={[]}
        // The preferences drawer edits columns, sort and filters, and this table's three
        // columns are all always shown, so there is nothing to commit. Sorting is fixed on
        // the roster order the server computed.
        onPreferencesApply={() => undefined}
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
    </section>
  )
}
