'use client'

// The question rows, drag-to-reorder (parity refs 09, 11).
//
// @dnd-kit is imported at this component rather than at a layout, per
// .claude/rules/bodo-conventions.md, and the pattern follows
// `DataTableSelectedColumns`: a pointer sensor plus a keyboard sensor, so the list is
// reorderable without a mouse. The row menu also carries Move up and Move down, because a
// drag handle alone leaves a keyboard user with no way to reorder at all.

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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import type { FormField } from '@/types/forms'

import { FieldRow } from './FieldRow'

export type FieldListProps = {
  fields: readonly FormField[]
  onReorder: (activeId: string, overId: string) => void
  onMove: (id: string, delta: number) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onRequiredChange: (id: string, required: boolean) => void
}

export function FieldList(props: FieldListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (props.fields.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No questions yet. Use + Add Field to add one.
      </p>
    )
  }

  function onDragEnd(event: DragEndEvent): void {
    const overId = event.over?.id
    if (overId === undefined) return
    props.onReorder(String(event.active.id), String(overId))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={props.fields.map((field) => field.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {props.fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              first={index === 0}
              last={index === props.fields.length - 1}
              onMove={props.onMove}
              onEdit={props.onEdit}
              onRemove={props.onRemove}
              onRequiredChange={props.onRequiredChange}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
