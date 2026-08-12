'use client'

// Per-reviewer completion for the active round, and the bulk nudge that goes with it.
//
// Round-level progress already existed and was accurate. It aggregated the committee
// together, so "6 of 12 reviews in" reads the same whether one reviewer has finished and
// one has not started or two are each half done, and those need different actions. This
// is the split, with the action attached to it.
//
// Everybody in the pool is listed, including a reviewer at 0 of 0. That row means the
// assignment step was missed rather than that somebody is slow, and it is the case a list
// of only-people-with-work would hide.

import { MailIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { remindReviewersAction } from '@/features/review/reminder-actions'
import type { ReviewerProgressRow } from '@/features/review/reviewer-progress'

export function ReviewerProgressPanel({
  eventId,
  roundId,
  rows,
}: {
  eventId: string
  roundId: string
  rows: readonly ReviewerProgressRow[]
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const behind = rows.filter((row) => row.outstanding > 0)

  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const remind = () => {
    startTransition(async () => {
      const result = await remindReviewersAction({
        eventId,
        roundId,
        // Empty means everyone behind, which the action recomputes for itself. It is a
        // filter over that list rather than the recipient list, so a stale tick cannot
        // mail somebody who has since finished.
        reviewerIds: [...picked],
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        result.skipped === 0
          ? `Reminder queued for ${String(result.queued)}`
          : `Reminder queued for ${String(result.queued)}. ${String(result.skipped)} already had one today.`,
      )
      setPicked(new Set())
    })
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has a role on this event yet. Add reviewers under Team.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.reviewerId} className="flex flex-wrap items-center gap-3">
          <Checkbox
            id={`remind-${row.reviewerId}`}
            checked={picked.has(row.reviewerId)}
            // Only somebody with outstanding work can be nudged, so the rest have no
            // checkbox rather than a checkbox that produces an error on submit.
            disabled={row.outstanding === 0}
            onCheckedChange={() => toggle(row.reviewerId)}
          />
          <Label htmlFor={`remind-${row.reviewerId}`} className="min-w-40 font-normal">
            {row.name}
          </Label>
          <Progress value={row.percent} className="w-32" />
          <span className="tabular-nums text-sm text-muted-foreground">
            {row.reviewed} of {row.assigned}
          </span>
          {row.recused === 0 ? null : (
            // Shown because the chair has a row to reassign, not because the reviewer is
            // behind: a recusal is counted as handled in `reviewed` above.
            <Badge variant="secondary">{row.recused} recused</Badge>
          )}
          {row.assigned === 0 ? <Badge variant="secondary">Nothing assigned</Badge> : null}
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending || behind.length === 0}
          onClick={remind}
        >
          <MailIcon />
          {picked.size === 0
            ? `Remind everyone behind (${behind.length})`
            : `Remind ${String(picked.size)} selected`}
        </Button>
        <span className="text-xs text-muted-foreground">
          One reminder per reviewer per day. Pressing this again today queues nothing.
        </span>
      </div>
    </div>
  )
}
