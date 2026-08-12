'use client'

// One portal form card.
//
// Ref 26 captured this list EMPTY, so the card is borrowed from its captured siblings on ref 25
// and the File Requests list rather than invented: name, chips, a kebab menu at the right, a
// divider, then a metadata row with the snippet, the type icon plus label, and the counter.
// BUILD_SPEC 5.6 calls the three surfaces one pattern, so a third card design would be a bigger
// invention than reusing theirs. `TaskTypeIcon` is reused for the same reason: ref 27's type
// cards carry the same three icons as ref 31's.
//
// The counter is the only place an organizer can see whether a form they built ever reached
// anybody, and it counts through the task that carries the form: see `toPortalFormCards`.

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import type { PortalFormCardView } from '@/features/portal-forms/cards'

import { TaskTypeIcon } from '../tasks/TaskTypeIcon'

export type PortalFormCardProps = {
  card: PortalFormCardView
  editHref: string
  onAssign: () => void
  disabled?: boolean
}

export function PortalFormCard({ card, editHref, onAssign, disabled }: PortalFormCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={editHref} className="min-w-0 truncate font-medium hover:underline">
              {card.name}
            </Link>
            <Badge variant="outline">
              {card.questions === 1 ? '1 question' : `${card.questions} questions`}
            </Badge>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={`Options for ${card.name}`}>
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={editHref} />}>Edit</DropdownMenuItem>
            <DropdownMenuItem disabled={disabled} onClick={onAssign}>
              Assign to accepted speakers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Separator />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {card.instructions === undefined ? null : (
          <span className="line-clamp-1 max-w-md">{card.instructions}</span>
        )}
        <span className="flex items-center gap-1.5">
          {card.entityType === undefined ? null : <TaskTypeIcon entityType={card.entityType} />}
          {card.typeLabel}
        </span>
        <span className="tabular-nums">
          {card.assigned === 0 ? 'Not assigned yet' : `${card.done}/${card.assigned} completed`}
        </span>
      </div>
    </div>
  )
}
