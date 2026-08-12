'use client'

// Where a session's content stands, and the control that sets it. CNT-12.
//
// Its own axis, not a variant of the acceptance status beside it. An accepted talk whose
// slides have not been read and one whose slides were sent back for changes were identical
// on every column this schema had, so "what still needs reading" could only be answered by
// opening every deck.
//
// It sits on the submission detail rather than on the Files table, because the thing being
// approved is the SESSION's content: a talk with three uploads has one approval state, and
// putting the control on each file would invite three different answers to one question.

import { InfoIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CONTENT_STATUSES, type ContentStatus, contentStatusLabel } from '@/constants/status'
import { setContentStatusAction } from '@/features/review/content-actions'

/**
 * What this control does to the public agenda, said where it is set.
 *
 * The gate in `publicSessionRows` has two modes and derives which one an agenda is in
 * (@/features/agenda/public-agenda), which is right for the data and invisible from here:
 * a session reading `Not submitted` is on the public page on an event that has approved
 * nothing, and off it on an event that has approved something. Without this sentence the
 * first case reads as a gate that does not work.
 */
export const CONTENT_STATUS_HELP =
  'Approved is what puts a session on the public agenda once you start approving. Pending review and Changes requested always keep it off. Until the first session on the agenda is approved, Not submitted sessions stay public, so turning this on for one session does not blank the schedule.'

/**
 * `approved` reads as a positive state and `changes_requested` as one needing attention.
 * The other two are neutral: not-submitted and pending are both just "not done yet", and
 * colouring them would make an ordinary early state look like a problem.
 */
const VARIANT: ReadonlyMap<ContentStatus, 'default' | 'secondary' | 'destructive'> = new Map([
  ['approved', 'default'],
  ['changes_requested', 'destructive'],
  ['pending_review', 'secondary'],
  ['not_submitted', 'secondary'],
])

export function ContentStatusControl({
  eventId,
  submissionId,
  status,
  canEdit,
}: {
  eventId: string
  submissionId: string
  status: ContentStatus
  /** False for a reviewer, who sees where content stands and does not decide it. */
  canEdit: boolean
}) {
  const [current, setCurrent] = useState<ContentStatus>(status)
  const [pending, startTransition] = useTransition()

  if (!canEdit) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Content</span>
        <Badge variant={VARIANT.get(current) ?? 'secondary'}>{contentStatusLabel(current)}</Badge>
      </span>
    )
  }

  const change = (next: ContentStatus) => {
    const previous = current
    // Moved before the write so the control does not sit inert while the round trip runs,
    // and put back on failure rather than left showing a state the base does not hold.
    setCurrent(next)
    startTransition(async () => {
      const result = await setContentStatusAction({ eventId, submissionId, status: next })
      if (!result.ok) {
        setCurrent(previous)
        toast.error(result.message)
        return
      }
      toast.success(`Content marked ${contentStatusLabel(next).toLowerCase()}`)
    })
  }

  return (
    <span className="flex items-center gap-1.5">
      <Label htmlFor="content-status" className="text-muted-foreground">
        Content
      </Label>
      {/* What this control does to the public agenda, next to the control. The gate derives
          its mode from the agenda, so `Not submitted` is public on one event and withheld on
          another, and only this sentence says that is deliberate. */}
      <Tooltip>
        {/* 26px, not 40: the `Label` on one side and the select trigger on the other each
            sit 6px away at `gap-1.5`, so from the 14px glyph's centre there is 7 + 6 = 13px
            of room in either direction, and 13 + 13 is what a hit area can span here. */}
        <TooltipTrigger className="text-muted-foreground hit-area-[26px]">
          <InfoIcon className="size-3.5" />
          <span className="sr-only">About Content status</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{CONTENT_STATUS_HELP}</TooltipContent>
      </Tooltip>
      <Select
        // Base UI's `Select.Value` prints the raw value unless the root is handed this map,
        // so the closed trigger read `not_submitted` where the open list read "Not submitted".
        items={Object.fromEntries(
          CONTENT_STATUSES.map((entry) => [entry, contentStatusLabel(entry)]),
        )}
        value={current}
        onValueChange={(next: string | null) => {
          const chosen = CONTENT_STATUSES.find((known) => known === next)
          if (chosen !== undefined && chosen !== current) change(chosen)
        }}
      >
        {/* `hit-area-y`: 176px wide and only 28 tall, so the miss is vertical. The row wraps
            at `gap-y-2` inside a 28px line, so 40 leaves 2px before the line below. */}
        <SelectTrigger id="content-status" size="sm" disabled={pending} className="w-44 hit-area-y">
          {/* A render function, not a bare `<SelectValue />`. Base UI's Select.Value prints
              the raw VALUE by default, so the closed trigger read `not_submitted` while the
              open list read `Not submitted`. Seen on the running app. */}
          <SelectValue>
            {(value: unknown) =>
              contentStatusLabel(CONTENT_STATUSES.find((known) => known === value) ?? current)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CONTENT_STATUSES.map((entry) => (
            <SelectItem key={entry} value={entry}>
              {contentStatusLabel(entry)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}
