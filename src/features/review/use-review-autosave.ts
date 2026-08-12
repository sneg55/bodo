'use client'

// The React side of the debounced autosave. Thin on purpose: the state machine and
// the coalescing live in autosave-queue.ts, which is testable without a DOM.
//
// The queue is built once, in a `useState` initializer, and never rebuilt, so it
// captures the `save` function it was mounted with. Two consequences, both deliberate:
//
//   - Moving to another submission is the CALLER's job, by giving the score card a
//     `key` of the submission id so React unmounts and remounts it. An effect that
//     rebuilt the queue when the id changed would race a save still in flight for the
//     previous submission, and the score would land on the wrong row.
//   - `save` must therefore not close over changing state. It closes over the event,
//     submission, and round ids, and those are exactly what the `key` holds fixed.

import { useEffect, useState } from 'react'

import type { ReviewRecommendation } from '@/constants/status'
import type { AutosaveState } from '@/features/review/autosave-queue'
import { createAutosaveQueue } from '@/features/review/autosave-queue'
import { mergeReviewDraft, type ReviewDraftState } from '@/features/review/review-draft'

export type ReviewSaver = (draft: ReviewDraftState) => Promise<void>

export type UseReviewAutosaveOptions = {
  readonly initial: ReviewDraftState
  readonly save: ReviewSaver
}

export type ReviewAutosave = {
  readonly draft: ReviewDraftState
  readonly state: AutosaveState
  readonly setScore: (criterionKey: string, value: number) => void
  /** The answer to a `text` criterion. Merged key by key, like a score. */
  readonly setNote: (criterionKey: string, value: string) => void
  readonly setComment: (comment: string) => void
  readonly setRecommendation: (recommendation: ReviewRecommendation) => void
  /** Declare or withdraw a conflict of interest on this submission. */
  readonly setRecused: (recused: boolean) => void
  readonly saveNow: () => void
}

export function useReviewAutosave({ initial, save }: UseReviewAutosaveOptions): ReviewAutosave {
  const [draft, setDraft] = useState<ReviewDraftState>(initial)
  const [state, setState] = useState<AutosaveState>({ status: 'idle' })

  const [queue] = useState(() =>
    createAutosaveQueue<ReviewDraftState>(initial, {
      merge: mergeReviewDraft,
      save,
      onState: setState,
      onDraft: setDraft,
      schedule: (run, delayMs) => {
        const timer = setTimeout(run, delayMs)
        return () => clearTimeout(timer)
      },
    }),
  )

  // Unmounting cancels the pending timer. It does not flush: a reviewer who closed
  // the panel does not want their half-typed comment written, and the "Unsaved
  // changes" indicator was on screen saying so.
  useEffect(() => queue.cancel, [queue])

  return {
    draft,
    state,
    setScore: (criterionKey, value) => queue.change({ scores: { [criterionKey]: value } }),
    setNote: (criterionKey, value) => queue.change({ notes: { [criterionKey]: value } }),
    setComment: (comment) => queue.change({ comment }),
    setRecommendation: (recommendation) => queue.change({ recommendation }),
    setRecused: (recused) => queue.change({ recused }),
    saveNow: () => {
      void queue.flush()
    },
  }
}
