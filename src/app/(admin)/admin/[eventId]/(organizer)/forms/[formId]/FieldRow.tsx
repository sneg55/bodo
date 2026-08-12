'use client'

// One question row, in the anatomy the parity doc transcribes for every step that has a
// question list: drag grip, label, required asterisk, "Locked" badge, type label,
// max-chars chip, Required toggle, "..." menu.
//
// A locked field keeps its Required toggle on AND disabled, and its Delete item disabled.
// Title is the locked field on an abstract form, and a form without it produces
// submissions titled "Untitled submission" (`prepareSubmission`), which is why the lock is
// enforced in `removeField` too rather than only in this menu.

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, MoreHorizontalIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { FIELD_TYPE_LABELS, type FormField } from '@/types/forms'
import { cn } from '@/utils/cn'

export type FieldRowProps = {
  field: FormField
  first: boolean
  last: boolean
  onMove: (id: string, delta: number) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onRequiredChange: (id: string, required: boolean) => void
}

export function FieldRow({
  field,
  first,
  last,
  onMove,
  onEdit,
  onRemove,
  onRequiredChange,
}: FieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  })
  const locked = field.locked === true
  const label = field.label.trim().length === 0 ? 'Untitled question' : field.label

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 px-2 py-2', isDragging && 'bg-muted/50')}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        className="cursor-grab text-muted-foreground"
        {...attributes}
        {...(listeners ?? {})}
      >
        <GripVerticalIcon />
        <span className="sr-only">{`Reorder ${label}`}</span>
      </Button>

      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{label}</span>
          {field.required ? (
            <span aria-hidden className="text-destructive">
              *
            </span>
          ) : null}
          {locked ? <Badge variant="secondary">Locked</Badge> : null}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {FIELD_TYPE_LABELS[field.type]}
          {field.maxLen === undefined ? null : (
            <Badge variant="outline">{`Max ${field.maxLen.toLocaleString('en-US')} chars`}</Badge>
          )}
        </span>
      </span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Required</span>
        <Switch
          checked={field.required}
          disabled={locked}
          aria-label={`${label} is required`}
          onCheckedChange={(checked) => onRequiredChange(field.id, checked)}
        />

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
            <MoreHorizontalIcon />
            <span className="sr-only">{`Options for ${label}`}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(field.id)}>Edit</DropdownMenuItem>
            <DropdownMenuItem disabled={first} onClick={() => onMove(field.id, -1)}>
              <ArrowUpIcon />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onClick={() => onMove(field.id, 1)}>
              <ArrowDownIcon />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={locked}
              onClick={() => onRemove(field.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  )
}
