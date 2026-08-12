import { describe, expect, it, vi } from 'vitest'

import {
  AUTOSAVE_DELAY_MS,
  type AutosaveState,
  createAutosaveQueue,
} from '@/features/review/autosave-queue'
import {
  draftFromReview,
  EMPTY_REVIEW_DRAFT,
  isRecommendation,
  mergeReviewDraft,
  recommendationLabel,
  sanitizeNotes,
  sanitizeScores,
} from '@/features/review/review-draft'
import type { Criterion, Review } from '@/types/domain'

/**
 * A manual clock. Debounce bugs are all timing bugs, and a test that sleeps is a test that
 * gets deleted the first time it flakes, which is the reason the queue takes `schedule` as
 * a dependency at all.
 */
function clock() {
  const pending: (() => void)[] = []
  return {
    schedule: (run: () => void) => {
      pending.push(run)
      return () => {
        const index = pending.indexOf(run)
        if (index >= 0) pending.splice(index, 1)
      }
    },
    pendingCount: () => pending.length,
    tick: () => {
      const due = [...pending]
      pending.length = 0
      for (const run of due) run()
    },
  }
}

type Draft = { value: string }

/** Lets every already-resolved promise settle without asserting on wall-clock time. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function harness(save: (draft: Draft) => Promise<void>) {
  const timer = clock()
  const states: AutosaveState[] = []
  const queue = createAutosaveQueue<Draft>(
    { value: '' },
    {
      merge: (current, patch) => ({ ...current, ...patch }),
      save,
      onState: (state) => states.push(state),
      schedule: timer.schedule,
    },
  )
  return { queue, timer, states, statuses: () => states.map((state) => state.status) }
}

describe('createAutosaveQueue', () => {
  it('coalesces edits inside one window into a single save', async () => {
    const saved: Draft[] = []
    const { queue, timer } = harness((draft) => {
      saved.push(draft)
      return Promise.resolve()
    })

    queue.change({ value: 'a' })
    queue.change({ value: 'ab' })
    queue.change({ value: 'abc' })
    // Three keystrokes, one armed timer: the earlier two were cancelled.
    expect(timer.pendingCount()).toBe(1)

    timer.tick()
    await settle()
    expect(saved).toEqual([{ value: 'abc' }])
  })

  it('reports pending, then saving, then saved', async () => {
    const { queue, timer, statuses } = harness(() => Promise.resolve())
    queue.change({ value: 'a' })
    expect(statuses()).toEqual(['pending'])
    timer.tick()
    await settle()
    expect(statuses()).toEqual(['pending', 'saving', 'saved'])
  })

  it('surfaces a failure with its message instead of dropping the score', async () => {
    const { queue, timer, states } = harness(() => Promise.reject(new Error('Airtable said no')))
    queue.change({ value: 'a' })
    timer.tick()
    await settle()

    const last = states.at(-1)
    expect(last?.status).toBe('error')
    expect(last?.message).toBe('Airtable said no')
  })

  it('does not retry a failure on a loop, which would burn the rate budget', async () => {
    const save = vi.fn(() => Promise.reject(new Error('nope')))
    const { queue, timer } = harness(save)
    queue.change({ value: 'a' })
    timer.tick()
    await settle()

    // One attempt, and nothing rearmed. The reviewer retries with the Save button; the
    // queue never retries by itself.
    expect(save).toHaveBeenCalledTimes(1)
    expect(timer.pendingCount()).toBe(0)
  })

  it('treats Save with nothing changed as a no-op rather than a redundant write', async () => {
    const save = vi.fn(() => Promise.resolve())
    const { queue, timer } = harness(save)
    queue.change({ value: 'a' })
    timer.tick()
    await settle()
    expect(save).toHaveBeenCalledTimes(1)

    await queue.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('re-saves once when an edit lands while a save is in flight', async () => {
    const seen: string[] = []
    let release: (() => void) | undefined
    const { queue, timer } = harness(async (draft) => {
      seen.push(draft.value)
      if (seen.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
    })

    queue.change({ value: 'first' })
    timer.tick()
    await settle()

    // Arrives mid-save. Without the version counter this keystroke would be lost and the
    // indicator would still read "Saved" for a value that was never sent.
    queue.change({ value: 'second' })
    release?.()
    await settle()
    await queue.flush()

    expect(seen).toEqual(['first', 'second'])
  })

  it('cancel drops a pending window without saving', () => {
    const save = vi.fn(() => Promise.resolve())
    const { queue, timer } = harness(save)
    queue.change({ value: 'half typed' })
    queue.cancel()
    timer.tick()
    expect(save).not.toHaveBeenCalled()
  })

  it('debounces at roughly the 800ms section 3.1 asks for', () => {
    expect(AUTOSAVE_DELAY_MS).toBe(800)
  })
})

describe('review draft', () => {
  const criteria: readonly Criterion[] = [
    { key: 'relevance', label: 'Relevance', kind: 'numeric', min: 1, max: 5, weight: 2 },
    { key: 'clarity', label: 'Clarity', kind: 'numeric', min: 1, max: 5, weight: 1 },
  ]

  it('merges scores key by key, so two criteria nudged together do not erase each other', () => {
    const first = mergeReviewDraft(EMPTY_REVIEW_DRAFT, { scores: { relevance: 4 } })
    const second = mergeReviewDraft(first, { scores: { clarity: 5 } })
    expect(second.scores).toEqual({ relevance: 4, clarity: 5 })
  })

  it('replaces the comment and the recommendation rather than merging them', () => {
    const draft = mergeReviewDraft(
      { scores: {}, notes: {}, recused: false, comment: 'old', recommendation: 'maybe' },
      { comment: 'new', recommendation: 'yes' },
    )
    expect(draft).toMatchObject({ comment: 'new', recommendation: 'yes' })
  })

  it('merges notes key by key too, for the same reason scores merge', () => {
    const first = mergeReviewDraft(EMPTY_REVIEW_DRAFT, { notes: { a: 'one' } })
    const second = mergeReviewDraft(first, { notes: { b: 'two' } })
    expect(second.notes).toEqual({ a: 'one', b: 'two' })
  })

  it('keeps a note only for a text criterion still in the rubric, and drops an empty one', () => {
    const rubric: readonly Criterion[] = [
      ...criteria,
      { key: 'chair', label: 'For the chair', kind: 'text', min: 0, max: 0, weight: 0 },
      { key: 'blank', label: 'Blank', kind: 'text', min: 0, max: 0, weight: 0 },
    ]
    expect(
      // `relevance` is a slider, so its prose is not a note; `retired` is gone from the
      // rubric entirely; `blank` was left empty.
      sanitizeNotes(
        { chair: 'Ran long last year', relevance: 'x', retired: 'y', blank: '  ' },
        rubric,
      ),
    ).toEqual({ chair: 'Ran long last year' })
  })

  it('drops a score for a criterion the round no longer has', () => {
    expect(sanitizeScores({ relevance: 3, retired: 5 }, criteria)).toEqual({ relevance: 3 })
  })

  it('clamps a score into its criterion range once, on the way in', () => {
    expect(sanitizeScores({ relevance: 9, clarity: -2 }, criteria)).toEqual({
      relevance: 5,
      clarity: 1,
    })
  })

  it('leaves a skipped criterion absent rather than defaulting it to zero', () => {
    expect(sanitizeScores({ relevance: 3 }, criteria)).toEqual({ relevance: 3 })
  })

  it('reads an existing review into a draft, and an absent one into an empty draft', () => {
    const review = {
      id: 'rev1',
      submissionId: 'sub1',
      roundId: 'round1',
      reviewerId: 'user1',
      scores: { relevance: 4 },
      notes: {},
      recused: false,
      comment: 'Strong',
      recommendation: 'yes',
      updatedAt: '2026-08-06T00:00:00.000Z',
    } satisfies Review

    expect(draftFromReview(review)).toEqual({
      scores: { relevance: 4 },
      notes: {},
      recused: false,
      comment: 'Strong',
      recommendation: 'yes',
    })
    expect(draftFromReview(undefined)).toEqual(EMPTY_REVIEW_DRAFT)
  })

  it('validates a recommendation coming off a toggle group', () => {
    expect(isRecommendation('maybe')).toBe(true)
    expect(isRecommendation('probably')).toBe(false)
    expect(recommendationLabel('maybe')).toBe('Maybe')
  })
})
