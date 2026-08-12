'use client'

// The SUBMISSIONS surface: page header, status tabs, toolbar, table, footer.
//
// One component behind three routes (`/submissions`, `/abstracts`, `/sessions`), because
// they are one table split on `reviewRequired` and nothing else about them differs. The
// `scope` prop carries which one is rendering and `features/review/submission-scope.ts`
// holds every word that changes with it. Forking this file per surface is how the three
// drift into three slightly different tables, which is the failure the shared primitives
// exist to prevent.
//
// Query state (tab, search, sort, filters, track, page, page size) lives in the URL, not
// in React state, because the server does the filtering and sorting. The DataTable
// primitive says so in its own header: on a table this wide the server is the only place
// those can happen without shipping the whole set to the browser. What stays local is
// what is genuinely a client concern: the search box's keystrokes before they are
// debounced into the URL, the row selection, the visible columns, and the row density.
//
// Nothing here calls `router.refresh()` after a write. Every action goes through
// `invalidate()` (invalidate.ts), which expires the tag the Airtable client cached under
// and re-renders this route as part of the action's own response. `refresh()` would add a
// round trip and invalidate no server cache entry, which is the trap BUILD_SPEC 6.1
// calls out.

import { CalendarIcon, ListIcon, ScrollTextIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useOptimistic, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DataTable } from '@/components/primitives/DataTable'
import type { DataTableDensity } from '@/components/primitives/data-table-types'
import { PageHeader } from '@/components/primitives/PageHeader'
import { DEFAULT_COLUMN_KEYS } from '@/constants/fields'
import type { SubmissionStatus } from '@/constants/status'
import { SORTABLE_ROW_KEYS } from '@/features/review/abstracts-accessors'
import {
  type AbstractsQueryState,
  buildAbstractsSearch,
  type QueryPatch,
} from '@/features/review/abstracts-query'
import type { AbstractRow } from '@/features/review/abstracts-rows'
import type { AbstractsView } from '@/features/review/abstracts-view'
import { type SubmissionScope, scopeCopy } from '@/features/review/submission-scope'
import { setStatusAction } from '@/features/submissions/decisions'
import { SavedViewsControl } from '@/features/views/SavedViewsControl'
import { applySavedView } from '@/features/views/saved-view-model'
import { ABSTRACTS_SURFACE, type SavedView } from '@/types/saved-views'
import { AbstractsOptionsMenu } from './AbstractsOptionsMenu'
import { AbstractsToolbarExtra } from './AbstractsToolbarExtra'
import { AddAbstractSheet } from './AddAbstractSheet'
import { ABSTRACTS_CATALOG, abstractColumns, EXTRA_DEFAULT_COLUMN_KEYS } from './abstracts-cells'

/**
 * Long enough that a typed word is one request, short enough that the table does not feel
 * detached from the box. The same budget reasoning as the review autosave: BUILD_SPEC 3.1
 * allows roughly five requests per second per base.
 */
const SEARCH_DEBOUNCE_MS = 350

/** Sized only. The PageHeader tile owns the colour and the alignment. */
const HEADER_ICON = 'size-5'

/**
 * The header icon per surface, matching the icon the sidebar entry carries
 * (admin-nav-sections.ts). Here rather than in `submission-scope.ts` because that module is
 * imported by server code and an icon is a component.
 *
 * ELEMENTS, not component references. A component pulled out of a map and rendered as
 * `<Icon />` is a component created during render, which `react-hooks/static-components`
 * refuses: React would treat each render's value as a new component type and reset its
 * state. These are three constant elements, so there is nothing to create.
 */
const SCOPE_ICONS: ReadonlyMap<SubmissionScope, ReactNode> = new Map([
  ['all', <ListIcon key="all" className={HEADER_ICON} />],
  ['abstracts', <ScrollTextIcon key="abstracts" className={HEADER_ICON} />],
  ['sessions', <CalendarIcon key="sessions" className={HEADER_ICON} />],
])

export type AbstractsTableProps = {
  eventId: string
  view: AbstractsView
  query: AbstractsQueryState
  /** The event's persisted views for the `abstracts` surface. */
  savedViews: readonly SavedView[]
  /**
   * The default view this request opened on, if any. The page has already folded its sort
   * and filters into `query`; what is left is the column set and the menu's mark.
   */
  openingView?: SavedView
  /** A reviewer can read this table. Only an admin may change anything on it. */
  canEdit: boolean
  /** Which of the three SUBMISSIONS surfaces this is. Decides the header and the copy. */
  scope: SubmissionScope
}

export function AbstractsTable({
  eventId,
  view,
  query,
  savedViews,
  openingView,
  canEdit,
  scope,
}: AbstractsTableProps) {
  const copy = scopeCopy(scope)
  const router = useRouter()
  const pathname = usePathname()

  const [search, setSearch] = useState(query.search)
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [columnKeys, setColumnKeys] = useState<readonly string[]>(
    openingView === undefined || openingView.columnKeys.length === 0
      ? [...DEFAULT_COLUMN_KEYS, ...EXTRA_DEFAULT_COLUMN_KEYS]
      : openingView.columnKeys,
  )
  const [density, setDensity] = useState<DataTableDensity>('default')
  // Which stored view the toolbar shows as picked. The state itself lives where it always
  // has: the columns in local state, the sort and filters in the URL.
  const [appliedViewId, setAppliedViewId] = useState<string | null>(openingView?.id ?? null)
  /**
   * The tab the visitor just pressed, shown while the server is still fetching its rows.
   *
   * The one piece of query state with an optimistic copy, and it earns it. Every other
   * control here shows its new value the instant it is used: the search box holds its own
   * keystrokes, the density menu closes on the chosen row. The tab strip's selection came
   * back from `query.tabId`, which means it moved only once the Airtable read returned, so
   * pressing a tab did nothing visible until then. That reads as a dead control, and on an
   * event where every submission shares one status the ROWS do not visibly change either,
   * so nothing at all appeared to happen.
   *
   * `useOptimistic` rather than state plus an effect: it reverts on its own when the
   * transition settles, so there is no second source of truth to clear and no cascading
   * render. The table dims while `tabPending`, which is what stops the strip from claiming
   * the rows under it have caught up.
   */
  const [optimisticTabId, setOptimisticTabId] = useOptimistic(query.tabId)
  const [tabPending, startTabTransition] = useTransition()

  // Debounced into the URL. The early return is what stops the effect from pushing the
  // value the server just handed back, which would be an endless navigation loop.
  useEffect(() => {
    if (search === query.search) return
    const timer = setTimeout(() => {
      router.replace(`${pathname}${buildAbstractsSearch(query, { search })}`, { scroll: false })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, query, pathname, router])

  const go = (patch: QueryPatch) => {
    router.replace(`${pathname}${buildAbstractsSearch(query, patch)}`, { scroll: false })
  }

  const changeStatus = (row: AbstractRow, next: SubmissionStatus) => {
    void (async () => {
      const result = await setStatusAction({
        eventId,
        submissionId: row.id,
        status: next,
      })
      if (result.ok) {
        toast.success('Saved successfully')
        return
      }
      // The lifecycle refusal lands here: "pending cannot become accepted: promote through
      // the accept or decline queue so Notify can send the email".
      toast.error(result.message)
    })()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* `iconSlot` rather than `icon`: SCOPE_ICONS holds elements, for the reason
          its own comment gives, and PageHeader cannot take a component out of it. */}
      <PageHeader
        iconSlot={SCOPE_ICONS.get(scope)}
        title={copy.title}
        description={copy.subtitle}
        actions={
          <>
            <AbstractsOptionsMenu
              eventId={eventId}
              query={query}
              columnKeys={columnKeys}
              selectedIds={selectedIds}
              scope={scope}
            />
            {canEdit && copy.canAdd ? (
              // The event's zone, not the browser's: the drawer's Starts At and Ends At
              // resolve a typed wall clock into an instant, and the rows in this table are
              // already formatted in the same zone.
              <AddAbstractSheet eventId={eventId} timeZone={view.timeZone} />
            ) : null}
          </>
        }
      />

      <DataTable<AbstractRow>
        rows={view.rows}
        rowId={(row) => row.id}
        columns={abstractColumns({
          ratingsLabel: view.ratingsLabel,
          canEditStatus: canEdit,
          eventId,
          onStatusChange: changeStatus,
        })}
        // Submissions plus Session Submitter and Speaker. Without those two the Columns
        // picker could not offer them back once removed, and printed their raw keys.
        catalog={ABSTRACTS_CATALOG}
        visibleColumnKeys={columnKeys}
        sort={query.sort}
        filters={query.filters}
        // Exactly the keys `rowText` and `rowNumber` can answer, Ratings included. The
        // registry's `column` flag is about the Airtable schema, and using it here is
        // what left the Ratings column unsortable while `ratingSortValue` sat unused.
        sortableKeys={SORTABLE_ROW_KEYS}
        onPreferencesApply={(next) => {
          setColumnKeys(next.columnKeys)
          go({ sort: next.sort, filters: next.filters })
        }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={copy.searchPlaceholder}
        tabs={view.tabs}
        activeTabId={optimisticTabId}
        tabsPending={tabPending}
        onTabChange={(tabId) => {
          // Selection is per result set: keeping ticked rows from Pending while looking at
          // Declined is how a bulk action hits the wrong records.
          setSelectedIds([])
          // Both inside the transition: `useOptimistic` only accepts an update from within
          // one, and wrapping the navigation is what keeps `tabPending` true until the new
          // rows commit rather than until `replace` returns.
          startTabTransition(() => {
            setOptimisticTabId(tabId)
            go({ tabId })
          })
        }}
        selectedIds={canEdit ? selectedIds : undefined}
        onSelectionChange={canEdit ? setSelectedIds : undefined}
        page={view.page}
        pageSize={query.pageSize}
        totalRows={view.totalRows}
        onPageChange={(page) => go({ page })}
        onPageSizeChange={(pageSize) => go({ pageSize })}
        density={density}
        onDensityChange={setDensity}
        emptyMessage={copy.emptyMessage}
        toolbarViews={
          <SavedViewsControl
            eventId={eventId}
            surface={ABSTRACTS_SURFACE}
            views={savedViews}
            current={{ columnKeys, sort: query.sort, filters: query.filters }}
            appliedId={appliedViewId}
            canEdit={canEdit}
            onApply={(saved) => {
              setAppliedViewId(saved?.id ?? null)
              // "All records" restores the surface's own default set rather than leaving
              // the last view's columns behind while the menu says nothing is applied.
              const next =
                saved === null
                  ? {
                      columnKeys: [...DEFAULT_COLUMN_KEYS, ...EXTRA_DEFAULT_COLUMN_KEYS],
                      sort: null,
                      filters: [],
                    }
                  : applySavedView(saved)
              setColumnKeys(next.columnKeys)
              // Through the URL, like every other change to the result set, so the server
              // does the sorting and filtering and the view stays shareable. The stored
              // keys are re-validated against `column: true` on the way back in
              // (`parseAbstractsQuery`), which is what stops a view saved against a
              // renamed field from filtering on a column that no longer sorts.
              go({ sort: next.sort, filters: next.filters })
            }}
          />
        }
        toolbarExtra={
          <AbstractsToolbarExtra
            eventId={eventId}
            tracks={view.tracks}
            trackId={query.trackId}
            onTrackChange={(trackId) => go({ trackId })}
            canEdit={canEdit}
            selectedIds={selectedIds}
            onSelectionClear={() => setSelectedIds([])}
          />
        }
      />
    </div>
  )
}
