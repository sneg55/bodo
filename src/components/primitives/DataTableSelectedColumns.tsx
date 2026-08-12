'use client'

// The Preferences drawer's right pane: "Selected (n)" with drag-to-reorder chips.
//
// @dnd-kit lives behind a dynamic import at the call site (BUILD_SPEC: TipTap,
// @dnd-kit, and charts are imported at the component that needs them, never at a
// layout), so the sort library only ships to someone who actually opened the
// drawer.

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
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RegistryField } from '@/constants/fields'
import { cn } from '@/utils/cn'

type ChipProps = { columnKey: string; label: string; onRemove: (key: string) => void }

/**
 * The grip and the remove cross are both `icon-xs`, so their visible box is 24px and
 * their pressable box was 24px with it. This widens the pressable box without moving
 * anything: the pseudo-element takes no layout space, and the chip's own surface is not
 * interactive, so growing past its edge collides with nothing horizontally.
 *
 * 36px tall rather than the 40px the guideline asks for, and the 4px is deliberate. The
 * chips stack on a 36px pitch (32px chip plus the list's `gap-1`), so a 40px target would
 * put the top of one chip's grip inside the bottom of the one above it, and a drag would
 * start on whichever element won. Two hit areas must never overlap, so this is the
 * largest size that does not: at 36px the neighbouring targets meet exactly and stop.
 */
const CHIP_HIT_AREA =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-9 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"

function SelectedColumnChip({ columnKey, label, onRemove }: ChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnKey,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border border-border bg-background px-1.5 py-1 text-sm',
        isDragging && 'opacity-70 shadow-md',
      )}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn('cursor-grab text-muted-foreground', CHIP_HIT_AREA)}
        {...attributes}
        {...(listeners ?? {})}
      >
        <GripVerticalIcon />
        <span className="sr-only">Reorder {label}</span>
      </Button>
      <span className="truncate">{label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn('ml-auto text-muted-foreground', CHIP_HIT_AREA)}
        onClick={() => onRemove(columnKey)}
      >
        <XIcon />
        <span className="sr-only">Remove {label}</span>
      </Button>
    </li>
  )
}

export type DataTableSelectedColumnsProps = {
  columnKeys: readonly string[]
  /**
   * The SURFACE's catalog, and the reason it is a prop rather than a global lookup.
   *
   * This pane used to label its chips with `registryField(key)`, which searches every
   * field the app has. On a table of submissions that is the same answer. On the speaker
   * CRM it is the wrong one twice over: half those keys are not in the global registry at
   * all, so they rendered as raw `eventCount`, and `tags` resolved to the SESSION tag
   * field, so a chip read "Tags" while the header one pane over read "Speaker Tags". One
   * key means different things on different surfaces.
   */
  fields: readonly RegistryField[]
  onReorder: (keys: readonly string[]) => void
  onRemove: (key: string) => void
}

export function DataTableSelectedColumns({
  columnKeys,
  fields,
  onReorder,
  onRemove,
}: DataTableSelectedColumnsProps) {
  // A Map, not a `.find` per chip: `security/detect-object-injection` rules out plain
  // object indexing, and this list re-renders on every drag frame.
  const labelByKey = new Map(fields.map((field) => [field.key, field.label]))
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over === null || active.id === over.id) {
      return
    }
    const from = columnKeys.indexOf(String(active.id))
    const to = columnKeys.indexOf(String(over.id))
    if (from === -1 || to === -1) {
      return
    }
    onReorder(arrayMove([...columnKeys], from, to))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...columnKeys]} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-1">
          {columnKeys.map((key) => (
            <SelectedColumnChip
              key={key}
              columnKey={key}
              label={labelByKey.get(key) ?? key}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

export default DataTableSelectedColumns
