'use client'

// What sits in the score sheet card: the sheet, an invitation to pick something, or a
// pending state while a navigation is in flight.
//
// Its own file rather than a branch inside EvaluationPanel, which is at the size limit.
//
// The pending branch is the point, and it is not decoration. Everything in the view belongs
// to the render the SERVER has already answered with, so between the click and the new RSC
// payload (several seconds on an Airtable-backed route) `selected` is still the item the
// reviewer clicked away FROM. The sheet went on showing the previous submission's answers,
// fully editable, which is how it came to be reported as one submission's answers being
// carried into the next: nothing was carried, the panel was confidently rendering stale
// content, and a reviewer who started typing was scoring the wrong row.
//
// The `key` on the score sheet stays exactly where it is. The autosave queue is built once
// per mount, so the key is what guarantees a save in flight cannot land on the row the
// reviewer just moved away from (use-review-autosave.ts).

import { Skeleton } from '@/components/ui/skeleton'
import type { QueueItem, RoundSummary } from '@/features/review/evaluation-view'

import { ScoreCard } from './ScoreCard'

export function ScoreCardSlot({
  eventId,
  pending,
  round,
  selected,
  onNext,
  onSaved,
}: {
  eventId: string
  /** A navigation is in flight, so everything below is the previous render's. */
  pending: boolean
  round: RoundSummary | undefined
  selected: QueueItem | undefined
  onNext?: () => void
  onSaved: () => void
}) {
  if (pending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <p className="text-sm text-muted-foreground">Loading the submission...</p>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (selected === undefined || round === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        Pick a submission from your queue to score it.
      </p>
    )
  }

  return (
    <ScoreCard
      key={selected.submissionId}
      eventId={eventId}
      roundId={round.id}
      submissionId={selected.submissionId}
      code={selected.code}
      title={selected.title}
      description={selected.description}
      criteria={round.criteria}
      authors={selected.authors}
      anonymous={round.anonymous}
      initial={selected.draft}
      reviewed={selected.reviewed}
      onNext={onNext}
      onSaved={onSaved}
    />
  )
}
