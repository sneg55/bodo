'use client'

// One kind's card in the portal content editor: Tasks, Forms, File Requests, Pages. The
// kind table itself is `./portal-item-kinds.ts`.
//
// THE RULE THIS CARD MUST NOT BREAK, and it is the reason for the wording on the Enabled
// column and in the picker: `PortalItems` is an EXPOSURE GATE OVER THE ASSIGNMENT, never a
// substitute for it. Switching a row on shows it in the portal to the people it ALREADY
// applies to (`features/assignments/fanout.ts` writes those, at accept time); switching it
// off hides the surface from every speaker whatever they were assigned. Nothing on this
// page writes an assignment, so no label here may be readable as "assign this to everyone".
//
// The table is the shared `DataTable` primitive, per BUILD_SPEC 5.0c. One consequence is
// visible and worth stating: the primitive renders its own `TableRow` and exposes no row
// wrapper, so the sortable node is the GRIP rather than the row. Dragging reorders
// correctly while only the grips travel under the cursor. The alternative was adding a
// row-wrapper prop to a primitive five surfaces already use, for one surface.
//
// Reorder is within the visible page, because the drag handles are the sortable nodes and
// only the current page renders any. At 25 rows a page that is the whole list on every
// event in the base; a longer one reorders a page at a time.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { GripVerticalIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { DataTable } from '@/components/primitives/DataTable'
import type { DataTableColumn } from '@/components/primitives/data-table-types'
import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { denseOrder, type PortalContentRow } from '@/features/portal-config/content'
import type { PortalItemType } from '@/types/resources'

import { AddItemsPicker } from './AddItemsPicker'
import { portalItemHref, portalItemKind } from './portal-item-kinds'

/** A module-level component, because `react-hooks/static-components` refuses one defined inline. */
function DragHandle({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id })
  return (
    <Button
      ref={setNodeRef}
      variant="ghost"
      size="icon-xs"
      className={isDragging ? 'cursor-grabbing' : 'cursor-grab text-muted-foreground'}
      {...attributes}
      {...(listeners ?? {})}
    >
      <GripVerticalIcon />
      <span className="sr-only">{`Reorder ${label}`}</span>
    </Button>
  )
}

export type PortalContentCardProps = {
  eventId: string
  itemType: PortalItemType
  rows: readonly PortalContentRow[]
  onChange: (rows: readonly PortalContentRow[]) => void
  /** Assignments per source record, for the two assignable kinds. Absent means unknown. */
  assigned?: ReadonlyMap<string, number>
  disabled?: boolean
  /**
   * Open every link out of this card in a new tab.
   *
   * On for the CREATE WIZARD and off for the editor page, and it is not a preference. This
   * card is rendered inside a modal holding a portal that does not exist yet: a name, a
   * filter set and four lists of switches, none of it written anywhere. Every link here
   * leaves the route, so in the wizard a same-tab navigation closed the dialog and threw all
   * of that away with no warning and no way back. The Pages card was the worst of them,
   * because with no resource pages on the event its ENTIRE body is the link.
   *
   * The alternative was to drop the links inside the wizard, which loses the one affordance
   * an organizer needs at exactly that moment: the card is telling them the list is empty,
   * so the next thing they want is to go make one.
   */
  openInNewTab?: boolean
}

export function PortalContentCard({
  eventId,
  itemType,
  rows,
  onChange,
  assigned,
  disabled = false,
  openInNewTab = false,
}: PortalContentCardProps) {
  const kind = portalItemKind(itemType)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const needle = search.trim().toLowerCase()
  const shown = rows.filter((row) => needle === '' || row.title.toLowerCase().includes(needle))
  const start = (page - 1) * pageSize
  const paged = shown.slice(start, start + pageSize)

  function setEnabled(itemId: string, enabled: boolean): void {
    onChange(rows.map((row) => (row.itemId === itemId ? { ...row, enabled } : row)))
  }

  function onDragEnd(event: DragEndEvent): void {
    const overId = event.over?.id
    if (overId === undefined) return
    const from = rows.findIndex((row) => row.itemId === String(event.active.id))
    const to = rows.findIndex((row) => row.itemId === String(overId))
    if (from === -1 || to === -1 || from === to) return
    // Dense-renumbered from 0 on every move, so a drag cannot leave a tie. A tie makes the
    // portal's own order depend on the sequence Airtable paginated the rows in, which is a
    // speaker-facing nav that reshuffles itself between reads with nothing written.
    onChange(denseOrder(arrayMove([...rows], from, to)))
  }

  // One binding for both halves of "opens elsewhere": the target and the sentence that says
  // so. `rel="noreferrer"` goes with `target="_blank"` always, and the two must not drift
  // apart, which is why they are spread rather than written out at each link.
  const away = openInNewTab ? ({ target: '_blank', rel: 'noreferrer' } as const) : {}
  const awayNote = openInNewTab ? <span className="sr-only"> (opens in a new tab)</span> : null

  const columns: readonly DataTableColumn<PortalContentRow>[] = [
    {
      key: `portal-item-${itemType}-name`,
      label: kind.title,
      help: `Opens the ${kind.noun} itself. Editing it there changes it everywhere it appears, not only on this portal.`,
      cell: (row) => (
        <Link
          href={portalItemHref(itemType, eventId, row.itemId)}
          className="font-medium hover:underline"
          {...away}
        >
          {row.title.trim() === '' ? `Untitled ${kind.noun}` : row.title}
          {awayNote}
        </Link>
      ),
    },
    // The column appears only where the counts do. It used to render for both assignable
    // kinds whether or not `assigned` had been read, so the create wizard, which reads no
    // assignments, drew a whole column of `-`: a heading promising a number beside a
    // placeholder that never resolves. Nothing to read and nothing to wait for.
    ...(kind.assignable && assigned !== undefined
      ? [
          {
            key: `portal-item-${itemType}-assigned`,
            label: 'Assigned speakers',
            help: 'How many speakers already owe this. Assignment is fanned out when a submission is accepted; nothing on this page adds or removes one.',
            cellClassName: 'tabular-nums',
            cell: (row: PortalContentRow) => String(assigned.get(row.itemId) ?? 0),
          },
        ]
      : []),
    {
      key: `portal-item-${itemType}-enabled`,
      label: 'Enabled',
      help: `Enabled shows this ${kind.noun} in the portal to the people it already applies to. Off hides it from everyone, whatever they were assigned.`,
      cellClassName: 'w-24',
      cell: (row) => (
        <Switch
          checked={row.enabled}
          disabled={disabled}
          aria-label={`${row.title} is enabled on this portal`}
          onCheckedChange={(next) => {
            setEnabled(row.itemId, next)
          }}
        />
      ),
    },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{kind.title}</CardTitle>
        {rows.length === 0 ? null : (
          <AddItemsPicker
            noun={kind.noun}
            options={rows.filter((row) => !row.enabled)}
            disabled={disabled}
            onAdd={(ids) => {
              const wanted = new Set(ids)
              onChange(
                rows.map((row) => (wanted.has(row.itemId) ? { ...row, enabled: true } : row)),
              )
            }}
          />
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <Link href={`/admin/${eventId}/${kind.createPath}`} className="underline" {...away}>
              {kind.emptyBody}
              {awayNote}
            </Link>
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={paged.map((row) => row.itemId)}
              strategy={verticalListSortingStrategy}
            >
              <DataTable
                rows={paged}
                rowId={(row) => row.itemId}
                columns={columns}
                visibleColumnKeys={columns.map((column) => column.key)}
                sort={null}
                filters={[]}
                // Order is the organizer's, set by dragging, so a three-column table has
                // nothing for the preferences drawer to commit.
                onPreferencesApply={() => undefined}
                search={search}
                onSearchChange={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
                searchPlaceholder={`Search ${kind.title.toLowerCase()}...`}
                page={page}
                pageSize={pageSize}
                totalRows={shown.length}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next)
                  setPage(1)
                }}
                rowActions={(row) => <DragHandle id={row.itemId} label={row.title} />}
                emptyMessage={`No ${kind.title.toLowerCase()} match this search.`}
              />
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  )
}
