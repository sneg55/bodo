'use client'

// One submission's score sheet: a slider per criterion, a comment, and yes/no/maybe.
//
// Autosave is debounced to one write per field per ~800ms and the save state is on screen
// at all times. BUILD_SPEC 3.1 is blunt about why: Airtable allows roughly five requests
// per second per base, and "an autosaving review form firing on every keystroke will hit
// that ceiling and start returning 429". The state machine is in
// features/review/autosave-queue.ts; this file is the controls.
//
// The caller MUST render this with `key={submissionId}`. The autosave queue is built once
// per mount so that a save still in flight cannot land on the row the reviewer just moved
// away from; the key is what makes moving on a remount.

import { useRef } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AppError } from '@/constants/errorIds'
import { saveReviewAction } from '@/features/review/actions'
import { autosaveLabel } from '@/features/review/autosave-queue'
import type { ReviewDraftState } from '@/features/review/review-draft'
import { useReviewAutosave } from '@/features/review/use-review-autosave'
import type { Criterion } from '@/types/domain'
import { cn } from '@/utils/cn'

import { CriterionControl } from './CriterionControl'
import { RoundVerdict } from './RoundVerdict'

export type ScoreCardProps = {
  eventId: string
  roundId: string
  submissionId: string
  code: string
  title: string
  /**
   * The abstract. Plain text, already flattened server side (abstract-text.ts).
   *
   * This card asked a reviewer to score a talk from its title, and the anonymisation
   * control next door says a reviewer "sees the title and the abstract". Only the first
   * half of that was true.
   */
  description: string
  criteria: readonly Criterion[]
  /**
   * Who submitted it. ABSENT on an anonymised round, where the names never leave the
   * server at all, rather than being present and styled away.
   */
  authors?: string
  /** True when this round is anonymised, so the card can say so instead of just omitting. */
  anonymous: boolean
  initial: ReviewDraftState
  /** Rendered as the Save and next control. Absent on the last card in the queue. */
  onNext?: () => void
  /**
   * Whether the server already holds a review from this reviewer for this submission.
   *
   * Only used to decide whether the FIRST save changes anything the surrounding page
   * renders. See `onSaved`.
   */
  reviewed?: boolean
  /**
   * Called once, after the save that first files this review.
   *
   * The queue's check mark and the round tab's `2/4` are both server data, and the autosave
   * asks the server for nothing after its write, so both sat at their pre-save values until
   * something else navigated: a reviewer scored a submission and the panel went on showing
   * it as outstanding. `saveReview` has already expired the tags through `invalidate()`, so
   * the caller only has to ask for the render.
   *
   * Once, and only when the review is new, because every keystroke after the debounce is
   * another save and a re-render per save is the round trip BUILD_SPEC 6.1 rules out.
   */
  onSaved?: () => void
}

export function ScoreCard({
  eventId,
  roundId,
  submissionId,
  code,
  title,
  description,
  criteria,
  authors,
  anonymous,
  initial,
  onNext,
  reviewed = false,
  onSaved,
}: ScoreCardProps) {
  // A ref rather than state: nothing renders from it, and setting state inside the save
  // would re-render the card mid-write. It lives for one mount, which is one submission,
  // because the caller keys this component by submission id.
  const filed = useRef<boolean>(reviewed)
  const autosave = useReviewAutosave({
    initial,
    save: async (draft) => {
      const result = await saveReviewAction({ eventId, submissionId, roundId, draft })
      // Thrown so the queue moves to `error` and the reason reaches the screen. A score
      // that silently failed to save is the one outcome section 3.1 rules out by name.
      if (!result.ok) throw new AppError(result.errorId, result.message)
      if (!filed.current) {
        filed.current = true
        onSaved?.()
      }
    },
  })

  const { draft, state } = autosave
  // Maps rather than object indexing, for the reason `scoreReview` gives: a criterion
  // key comes from Airtable, so indexing a plain object with it is the dynamic read the
  // security lint exists to stop, and it would hand back `number` for a key that is not
  // there.
  const scores = new Map(Object.entries(draft.scores))
  const notes = new Map(Object.entries(draft.notes))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs tabular-nums text-muted-foreground">{code}</p>
          <h2 className="font-heading text-base font-medium">{title}</h2>
          {anonymous ? (
            // Said out loud rather than left as an absence. That absence is exactly what
            // ABS-07 failed on: reviewers never saw an author, and nothing anywhere told
            // them that was a decision rather than a missing field.
            <Badge variant="secondary" className="mt-1">
              Anonymised
            </Badge>
          ) : authors === undefined ? null : (
            <p className="mt-0.5 text-sm text-muted-foreground">{authors}</p>
          )}
        </div>
        <p
          className={cn(
            'text-xs',
            state.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {state.status === 'error' ? state.message : autosaveLabel(state.status)}
        </p>
      </div>

      {/* The abstract, which is the thing being scored. It is above the conflict-of-interest
          switch and the rubric because a reviewer has to read it before either is a
          question they can answer.

          `whitespace-pre-line` because the flattening collapses runs of whitespace but the
          body can still be several paragraphs, and a wall of text is its own kind of
          missing. Scrolls at a fixed height rather than pushing the rubric off the screen
          on a five-thousand-character submission. */}
      {description === '' ? (
        <p className="text-sm text-muted-foreground italic">
          This submission has no abstract on file.
        </p>
      ) : (
        <p className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-line">
          {description}
        </p>
      )}

      {/* The conflict-of-interest switch, above the rubric rather than below it: a
          reviewer who should not be scoring this one needs to say so before working
          through the criteria, not after. Declaring it clears the scores and the
          recommendation server side, so it is not a display state. */}
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Switch
          id={`recuse-${submissionId}`}
          checked={draft.recused}
          onCheckedChange={(next: boolean) => autosave.setRecused(next)}
        />
        <div className="space-y-0.5">
          <Label htmlFor={`recuse-${submissionId}`}>Conflict of interest</Label>
          <p className="text-sm text-muted-foreground">
            {draft.recused
              ? 'You are recused. This submission is not scored by you and does not count against your progress.'
              : 'Recuse yourself if you cannot judge this one impartially.'}
          </p>
        </div>
      </div>

      {draft.recused || criteria.length !== 0 ? null : (
        <p className="text-sm text-muted-foreground">
          This round has no criteria yet, so only the comment and the recommendation are scored.
        </p>
      )}

      {(draft.recused ? [] : criteria).map((criterion) => (
        <CriterionControl
          key={criterion.key}
          criterion={criterion}
          score={scores.get(criterion.key)}
          note={notes.get(criterion.key) ?? ''}
          onScore={(next) => autosave.setScore(criterion.key, next)}
          onNote={(next) => autosave.setNote(criterion.key, next)}
        />
      ))}

      <RoundVerdict
        recused={draft.recused}
        recommendation={draft.recommendation}
        comment={draft.comment}
        onRecommendation={autosave.setRecommendation}
        onComment={autosave.setComment}
      />

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={state.status === 'saving'}
          onClick={autosave.saveNow}
        >
          Save
        </Button>
        {onNext === undefined ? null : (
          <Button
            size="sm"
            onClick={() => {
              // Flush before moving on, so the pending debounce window is not thrown away
              // by the remount the parent is about to cause.
              autosave.saveNow()
              onNext()
            }}
          >
            Save and next
          </Button>
        )}
      </div>
    </div>
  )
}
