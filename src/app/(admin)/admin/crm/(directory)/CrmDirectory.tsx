'use client'

// The cross-event speaker directory's client half: header, toolbar, table, footer.
//
// Query state (search, sort, filters, page, page size) lives in the URL rather than in
// React state, because the server does the filtering and the sorting: the DataTable
// primitive is fully controlled and says so in its own header. What stays local is what is
// genuinely a client concern, which here is the search box's keystrokes before they are
// debounced into the URL, the visible column set, and the row density.
//
// No tab strip. The submission surfaces have one because a submission has a lifecycle;
// a person does not, and the audit's own tab strips are all statuses. Dynamic lists are the
// equivalent control here and they land IN the toolbar, in the `toolbarViews` slot that
// Saved Views occupies on Abstracts and the Agenda List: one stored-query control, in the
// one place the reference puts one.

import { ChartNoAxesColumnIcon, CopyIcon, UploadIcon, UsersIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { DataTable } from '@/components/primitives/DataTable'
import type { DataTableDensity } from '@/components/primitives/data-table-types'
import { PageHeader } from '@/components/primitives/PageHeader'
import { Button } from '@/components/ui/button'
import {
  SPEAKER_CRM_CATALOG,
  SPEAKER_CRM_DEFAULT_COLUMN_KEYS,
} from '@/constants/speaker-crm-fields'
import { CrmBulkEmailButton } from '@/features/comms/CrmBulkEmailButton'
import { CrmFilterSummary } from '@/features/crm/CrmFilterSummary'
import type { CrmDirectoryView } from '@/features/crm/directory'
import {
  buildCrmSearch,
  type CrmQueryPatch,
  type CrmQueryState,
} from '@/features/crm/directory-query'
import { MergeSpeakersButton } from '@/features/crm/MergeSpeakersButton'
import { NewContactButton } from '@/features/crm/NewContactButton'
import { SpeakerListPicker } from '@/features/crm/SpeakerListPicker'
import { speakerColumns } from '@/features/crm/speaker-columns'
import type { SpeakerRow } from '@/features/crm/speaker-rows'

/**
 * Long enough that a typed word is one request, short enough that the table does not feel
 * detached from the box. The same budget the Abstracts table uses, for the same reason:
 * roughly five Airtable requests per second per base.
 */
const SEARCH_DEBOUNCE_MS = 350

export type CrmDirectoryProps = {
  view: CrmDirectoryView
  query: CrmQueryState
}

/** "3 events" reads better than "3 event", and the count is genuinely often 1. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function CrmDirectory({ view, query }: CrmDirectoryProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [search, setSearch] = useState(query.search)
  const [columnKeys, setColumnKeys] = useState<readonly string[]>(SPEAKER_CRM_DEFAULT_COLUMN_KEYS)
  const [density, setDensity] = useState<DataTableDensity>('default')
  // Row selection: what merge consumes, and what the bulk email composer reads too. Ids
  // rather than rows, matching the primitive's contract, and cleared on every navigation
  // below - an id from page 1 cannot be resolved to a name on page 2, so carrying it would
  // put a record into a merge that the organizer can no longer see.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])

  // Debounced into the URL. The early return is what stops the effect from pushing back
  // the value the server just handed it, which would be an endless navigation loop.
  useEffect(() => {
    if (search === query.search) return
    const timer = setTimeout(() => {
      router.replace(`${pathname}${buildCrmSearch(query, { search })}`, { scroll: false })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, query, pathname, router])

  const go = (patch: CrmQueryPatch) => {
    setSelectedIds([])
    router.replace(`${pathname}${buildCrmSearch(query, patch)}`, { scroll: false })
  }

  // Resolved against the rows the server sent, not remembered from when they were ticked, so
  // a merge dialog can never name a record the table is no longer showing.
  const selectedRows = view.rows.filter((row) => selectedIds.includes(row.speaker.id))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={UsersIcon}
        title="CRM"
        description={`${plural(view.speakerCount, 'speaker')} across ${plural(view.eventCount, 'event')} you belong to.`}
        actions={
          // The reference reaches its importer through `Options > Import` inside the module
          // (docs/parity/external-references.md). A one-item menu is a chevron hiding a
          // button, and the parity report waives the CRM area anyway, so the import is the
          // button. Two buttons now that the dashboard exists, and still not a menu: two is
          // the point at which a chevron starts costing a click to save a pixel.
          //
          // `Add Contact` is the third, and it is a `Button` rather than a `ButtonLink`
          // because it RUNS code: it opens a dialog in place instead of navigating. Import
          // stays beside it and stays the bulk path.
          <>
            <ButtonLink href="/admin/crm/dashboard" variant="outline">
              <ChartNoAxesColumnIcon />
              Dashboard
            </ButtonLink>
            <ButtonLink href="/admin/crm/import" variant="outline">
              <UploadIcon />
              Import
            </ButtonLink>
            <NewContactButton events={view.creatableEvents} />
          </>
        }
      />

      <DataTable<SpeakerRow>
        rows={view.rows}
        rowId={(row) => row.speaker.id}
        columns={speakerColumns(view.duplicateReasons)}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        catalog={SPEAKER_CRM_CATALOG}
        visibleColumnKeys={columnKeys}
        sort={query.sort}
        filters={query.filters}
        toolbarViews={
          <>
            <SpeakerListPicker
              lists={view.lists}
              userId={view.userId}
              filters={query.filters}
              onApply={(filters) => go({ filters })}
            />
            {/* What the table is filtered BY, which nothing said before: the Filter button
                looked the same either way and the only trace of an applied filter was the
                query string. Two eval agents reported the same thing. It renders nothing on
                an unfiltered table, so it sits immediately left of Columns / Sort / Filter
                only when there is something to say. */}
            <CrmFilterSummary filters={query.filters} onChange={(filters) => go({ filters })} />
          </>
        }
        toolbarExtra={
          <>
            {/* The duplicates view. A toggle in the toolbar rather than a banner above the
                table, because it is a way of LOOKING at the directory, which is what every
                other control in this strip is. It carries its own count, so an organizer who
                has never opened it still learns the number is not zero.
                Rendered only when there is something to see: a control reading `Duplicates 0`
                that filters to an empty table is worse than no control. */}
            {view.duplicateSummary.records === 0 && !query.duplicatesOnly ? null : (
              <Button
                variant={query.duplicatesOnly ? 'default' : 'outline'}
                onClick={() => go({ duplicatesOnly: !query.duplicatesOnly })}
              >
                <CopyIcon />
                {`Duplicates ${view.duplicateSummary.records}`}
              </Button>
            )}
            {/* CRM-11. The same selection merge reads, and the same composer the speakers
                roster opens. It is NOT gated on `view.canMerge`: merging is destructive and
                needs admin on every event the records touch, while sending needs admin on the
                one event chosen inside the drawer, which the composer resolves for itself and
                which a reviewer-only viewer is told about there rather than by a control that
                silently is not here. */}
            <CrmBulkEmailButton
              speakerIds={selectedRows.map((row) => row.speaker.id)}
              onSent={() => setSelectedIds([])}
            />
            {view.canMerge ? (
              <MergeSpeakersButton rows={selectedRows} onMerged={() => setSelectedIds([])} />
            ) : null}
          </>
        }
        onPreferencesApply={(next) => {
          setColumnKeys(next.columnKeys)
          go({ sort: next.sort, filters: next.filters })
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search speakers..."
        page={view.page}
        pageSize={query.pageSize}
        totalRows={view.totalRows}
        onPageChange={(page) => go({ page })}
        onPageSizeChange={(pageSize) => go({ pageSize })}
        density={density}
        onDensityChange={setDensity}
        emptyMessage="No speakers found."
      />
    </div>
  )
}
