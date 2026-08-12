'use client'

// One task card, as ref 25 draws it: title, `Manual` chip, the row action at the right, a
// divider, then a metadata row with the description snippet and the type icon plus label.
//
// Two additions to the captured layout, both facts the reference screenshot had no reason to
// show and this build does: a selection checkbox (assigning is a bulk action here, and ref 25
// captured no assignment UI at all) and an `n assigned / n done` counter, which is the only
// place an organizer can see whether a task they defined ever reached anybody.
//
// **The kebab is a labelled button** (2026-08-11). Ref 25 draws a `···` at this corner and does
// not capture what is behind it; this build has exactly one thing, so the menu was a press to
// open a list of one. Worse than an extra press: `disabled` sat on the ITEM, so a reviewer, who
// may read this page and may not write to it, got a live `···` that opened a menu holding one
// greyed row. On the button the same flag disables the thing you can see. Found by codex review
// of the `+ Add` change, which is the same collapse.
//
// It goes back to a `DropdownMenu` when a second row action exists (ref 25's kebab presumably
// has several in the real product; none of the others are built).

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import type { TaskCardView } from '@/features/tasks/cards'

import { TaskTypeIcon } from './TaskTypeIcon'

export type TaskCardProps = {
  card: TaskCardView
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  onAssign: () => void
  disabled?: boolean
}

export function TaskCard({ card, selected, onSelectedChange, onAssign, disabled }: TaskCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Wraps because the action is a labelled button now, and `Button` is `shrink-0` with
          `whitespace-nowrap`: on a narrow card it would hold its full width and squeeze the
          truncating title toward nothing. Wrapping drops it to its own line instead. */}
      <div className="flex flex-wrap items-start gap-3">
        <Checkbox
          checked={selected}
          disabled={disabled}
          aria-label={`Select ${card.title}`}
          onCheckedChange={(next) => onSelectedChange(next === true)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{card.title}</span>
            {card.manual ? <Badge variant="secondary">Manual</Badge> : null}
            {card.formName === undefined ? null : <Badge variant="outline">{card.formName}</Badge>}
          </div>
          {card.dueLabel === undefined ? null : (
            <span className="text-xs text-muted-foreground">{card.dueLabel}</span>
          )}
        </div>

        {/* The card title is in the accessible name because every card renders this same
            sentence: without it a screen reader tabbing the list hears "Assign to accepted
            speakers" twenty times with nothing to tell the rows apart. The visible label leads,
            so the accessible name still contains it verbatim. The kebab carried the title the
            same way, in `Options for ...`. */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Assign to accepted speakers: ${card.title}`}
          onClick={onAssign}
        >
          Assign to accepted speakers
        </Button>
      </div>

      <Separator />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {card.description === undefined ? null : (
          <span className="line-clamp-1 max-w-md">{card.description}</span>
        )}
        <span className="flex items-center gap-1.5">
          <TaskTypeIcon entityType={card.entityType} />
          {card.typeLabel}
        </span>
        <span className="tabular-nums">
          {card.assigned === 0
            ? 'Not assigned yet'
            : `${card.done}/${card.assigned} done across ${card.assigned} assignment${card.assigned === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  )
}
