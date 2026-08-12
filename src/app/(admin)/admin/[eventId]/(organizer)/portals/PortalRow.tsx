'use client'

// The portal list's rows, in ASSIGNMENT ORDER, and the @dnd-kit boundary for the route.
// `PortalList` pulls this file in through `next/dynamic`, per the rule that TipTap, @dnd-kit
// and charts are imported at the component that needs them and never at a layout.
//
// THE DEFAULT PORTAL IS PINNED FIRST AND ITS HANDLE IS DISABLED. §5.0c says it "cannot be
// deleted or reordered below a custom one", which is "it stays at the top", so it is
// rendered outside the `SortableContext` rather than inside it with a guard: a row that
// cannot legally move should not be draggable in the first place.
//
// Its position is PRESENTATIONAL, and that is worth saying, because "the fallback sits
// first in a first-match-wins list" reads as a bug to anyone who has not read `match.ts`.
// It is not one. `matchPortal` never treats the default as a candidate: it is fallen back
// to rather than matched, and any stray filters on it are ignored. So a default at order 0
// does not swallow the conference the way a custom portal at order 0 would.
// `reorderPortalsAction` writes the default at 0 and renumbers the customs from 1 whatever
// this component reports, so the pinning is belt and braces rather than the enforcement.

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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CopyIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  SquarePenIcon,
  Trash2Icon,
} from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { PortalKind } from '@/types/portals'
import { cn } from '@/utils/cn'

import { labelOf, PORTAL_KIND_LABELS } from './portal-filter-labels'

export type PortalRowView = {
  id: string
  name: string
  kind: PortalKind
  isDefault: boolean
  /** How many of the event's contacts land here right now. Zero is a real answer. */
  matchedCount: number
}

export type PortalRowsProps = {
  eventId: string
  /** Any order. The default is pinned first here so one component owns the rule. */
  rows: readonly PortalRowView[]
  disabled?: boolean
  onReorder: (activeId: string, overId: string) => void
  onDelete: (row: PortalRowView) => void
  onDuplicate: (row: PortalRowView) => void
}

export function PortalRows({
  eventId,
  rows,
  disabled = false,
  onReorder,
  onDelete,
  onDuplicate,
}: PortalRowsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const fallback = rows.find((row) => row.isDefault)
  const custom = rows.filter((row) => !row.isDefault)

  function onDragEnd(event: DragEndEvent): void {
    const overId = event.over?.id
    if (overId === undefined) return
    onReorder(String(event.active.id), String(overId))
  }

  return (
    <div className="flex flex-col gap-2">
      {fallback === undefined ? null : (
        <PortalRow
          eventId={eventId}
          row={fallback}
          disabled={disabled}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={custom.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          {custom.map((row) => (
            <PortalRow
              key={row.id}
              eventId={eventId}
              row={row}
              disabled={disabled}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}

function PortalRow({
  eventId,
  row,
  disabled,
  onDelete,
  onDuplicate,
}: {
  eventId: string
  row: PortalRowView
  disabled: boolean
  onDelete: (row: PortalRowView) => void
  onDuplicate: (row: PortalRowView) => void
}) {
  // Called unconditionally, including on the default row, because hooks cannot be
  // conditional. The default is outside every `SortableContext`, so the hook returns inert
  // handlers and the handle below is disabled anyway.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  })
  const editHref = `/admin/${eventId}/portals/${row.id}`

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'bg-muted/50')}
    >
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={disabled || row.isDefault}
          className={row.isDefault ? 'text-muted-foreground' : 'cursor-grab text-muted-foreground'}
          {...attributes}
          {...(listeners ?? {})}
        >
          <GripVerticalIcon />
          <span className="sr-only">
            {row.isDefault ? `${row.name} always sits first` : `Reorder ${row.name}`}
          </span>
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={editHref} className="truncate font-medium hover:underline">
              {row.name}
            </Link>
            <Badge variant="outline">{labelOf(PORTAL_KIND_LABELS, row.kind)}</Badge>
            {row.isDefault ? <Badge variant="secondary">Default</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {`${String(row.matchedCount)} ${row.matchedCount === 1 ? 'contact' : 'contacts'} land here`}
            {row.isDefault ? ', because they match no portal above' : ''}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={disabled} />}>
            <MoreHorizontalIcon />
            <span className="sr-only">{`Options for ${row.name}`}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={editHref} />}>
              <SquarePenIcon />
              Edit Tasks
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                onDuplicate(row)
              }}
            >
              <CopyIcon />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {row.isDefault ? (
              // Disabled and told why, rather than a dead item or a missing one: an
              // organizer who cannot find Delete assumes the menu is broken, and one who
              // clicks a silent no-op assumes the app is.
              <DropdownMenuItem disabled className="flex-col items-start gap-0">
                <span>Delete</span>
                <span className="text-xs">
                  The default portal cannot be deleted. Every contact who matches no filter lands
                  here.
                </span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  onDelete(row)
                }}
              >
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  )
}
