'use client'

// One file request card.
//
// Ref 30 captured this list with nothing in it, so the card is borrowed from its captured
// sibling on ref 25 rather than invented: title, chips, the row action at the right, a divider,
// then a metadata row with the snippet and the type icon plus label. What is specific to a
// request is the `Required` chip (a schema column ref 31 has no control for, see
// request-draft.ts) and the delivered counter, which is the only place an organizer can see
// whether a request they created ever reached anybody.
//
// `TaskTypeIcon` is reused rather than copied. It switches on the same `entityType` vocabulary
// and ref 31's type cards carry the same three icons as ref 27's.
//
// The kebab is a labelled button for the reason `TaskCard` gives at length (2026-08-11): one
// item behind a `···` is a press to open a list of one, and `disabled` on the item left a live
// trigger over an inert menu for anyone without write access. Borrowed sibling, borrowed fix.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import type { RequestCardView } from '@/features/file-requests/cards'

import { TaskTypeIcon } from '../tasks/TaskTypeIcon'

export type RequestCardProps = {
  card: RequestCardView
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  onAssign: () => void
  disabled?: boolean
}

export function RequestCard({
  card,
  selected,
  onSelectedChange,
  onAssign,
  disabled,
}: RequestCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Wraps for the reason `TaskCard` spells out: a `shrink-0` labelled button beside a
          truncating title takes its width out of the title on a narrow card. */}
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
            {card.required ? <Badge variant="secondary">Required</Badge> : null}
          </div>
          {card.dueLabel === undefined ? null : (
            <span className="text-xs text-muted-foreground">{card.dueLabel}</span>
          )}
        </div>

        {/* Title in the accessible name, visible label first, same reasoning as `TaskCard`. */}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Request from accepted speakers: ${card.title}`}
          onClick={onAssign}
        >
          Request from accepted speakers
        </Button>
      </div>

      <Separator />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {card.instructions === undefined ? null : (
          <span className="line-clamp-1 max-w-md">{card.instructions}</span>
        )}
        <span className="flex items-center gap-1.5">
          <TaskTypeIcon entityType={card.entityType} />
          {card.typeLabel}
        </span>
        <span className="tabular-nums">
          {card.assigned === 0
            ? 'Not requested from anybody yet'
            : `${card.received}/${card.assigned} received`}
        </span>
      </div>
    </div>
  )
}
