'use client'

// The line between the round tabs and the queue: which round you are in, how far the
// committee has got, and whether the round you are looking at is still the one on screen.
//
// Lifted out of EvaluationPanel.tsx when the pending state landed there and pushed that file
// over the size limit. It is the right seam anyway: this is the only thing on the surface
// that has to say "loading" out loud, because a round switch replaces every number below it.

import { LoaderCircleIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { RoundSummary } from '@/features/review/evaluation-view'

export function RoundProgress({
  round,
  pending,
}: {
  round: RoundSummary
  /**
   * True while a round switch is in flight, so this line can say that the numbers under it
   * are the OLD round's. Without it the tab highlighted immediately and everything below
   * carried on showing the previous round for as long as the read took, which reads as a
   * click that did not register.
   */
  pending: boolean
}) {
  const percent = round.assigned === 0 ? 0 : Math.round((round.reviewed / round.assigned) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium">
          {round.name}
          {round.anonymous ? <Badge variant="secondary">Anonymised</Badge> : null}
          {round.reviewerIds.length === 0 ? null : (
            <Badge variant="secondary">{round.reviewerIds.length} in pool</Badge>
          )}
        </span>
        {/* Announced rather than toasted: it is a state of this line and it ends on its
            own, so a toast would be a dismissible thing to dismiss. */}
        <span
          aria-live="polite"
          className="flex items-center gap-2 tabular-nums text-muted-foreground"
        >
          {pending ? (
            <>
              <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
              Loading round...
            </>
          ) : (
            <>
              {round.reviewed} of {round.assigned} reviews in, {round.criteria.length} criteria
            </>
          )}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  )
}
