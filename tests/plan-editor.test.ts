// The evaluation plan editor's rules.
//
// The two that matter most are the ones a UI test would never catch: a criterion key
// survives a rename, and a dropdown's scoring range comes from its options rather than
// from the numeric fields sitting next to it in the form.

import { describe, expect, it } from 'vitest'

import {
  criterionKey,
  criterionProblems,
  moveCriterion,
  newCriterion,
  normalizeCriterion,
  weightShares,
} from '@/features/review/plan-editor'
import { scoreReview } from '@/features/review/scoring'
import type { Criterion } from '@/types/domain'

const numeric = (key: string, weight: number, max = 5): Criterion => ({
  key,
  label: key,
  kind: 'numeric',
  min: 1,
  max,
  weight,
})

describe('criterionKey', () => {
  it('slugs the label', () => {
    expect(criterionKey('Technical Depth', [])).toBe('technical-depth')
  })

  it('suffixes rather than collides, because a key is what a score is filed under', () => {
    expect(criterionKey('Depth', ['depth'])).toBe('depth-2')
    expect(criterionKey('Depth', ['depth', 'depth-2'])).toBe('depth-3')
  })

  it('falls back when the label has nothing sluggable in it', () => {
    expect(criterionKey('★★★', [])).toBe('criterion')
  })
})

describe('normalizeCriterion', () => {
  it('derives a dropdown range from its options and ignores the numeric fields', () => {
    const normalized = normalizeCriterion({
      key: 'delivery',
      label: ' Delivery ',
      kind: 'select',
      // Deliberately wrong: this is what the form's numeric inputs happened to hold.
      min: 1,
      max: 5,
      weight: 2,
      options: [
        { label: 'Weak', value: 2 },
        { label: 'Strong', value: 8 },
      ],
    })

    expect(normalized).toMatchObject({ label: 'Delivery', min: 2, max: 8 })
  })

  it('drops an option with no label', () => {
    const normalized = normalizeCriterion({
      key: 'k',
      label: 'K',
      kind: 'select',
      min: 0,
      max: 0,
      weight: 1,
      options: [
        { label: 'Yes', value: 1 },
        { label: '   ', value: 2 },
      ],
    })

    expect(normalized.options).toEqual([{ label: 'Yes', value: 1 }])
  })

  it('repairs a reversed numeric range rather than refusing the save', () => {
    const normalized = normalizeCriterion({
      key: 'k',
      label: 'K',
      kind: 'numeric',
      min: 10,
      max: 1,
      weight: 1,
    })

    expect(normalized).toMatchObject({ min: 1, max: 10 })
  })

  it('forces a text criterion to weight zero, because prose cannot be averaged', () => {
    const normalized = normalizeCriterion({
      key: 'k',
      label: 'Notes',
      kind: 'text',
      min: 1,
      max: 5,
      weight: 9,
    })

    expect(normalized).toMatchObject({ weight: 0, min: 0, max: 0 })
  })

  it('forces a select criterion to weight zero, because its option values are not a promised direction', () => {
    // The same fix scoring.ts makes: an option's numeric value cannot be trusted to
    // run worse-to-better, so a dropdown never contributes to the weighted mean, no
    // matter what weight the form held.
    const normalized = normalizeCriterion({
      key: 'recommendation',
      label: 'Recommendation',
      kind: 'select',
      min: 1,
      max: 3,
      weight: 9,
      options: [
        { label: 'Accept', value: 1 },
        { label: 'Reject', value: 3 },
      ],
    })

    expect(normalized).toMatchObject({ weight: 0, min: 1, max: 3 })
  })

  it('clamps a negative weight to zero rather than inverting the criterion', () => {
    expect(normalizeCriterion(numeric('k', -3)).weight).toBe(0)
  })
})

describe('criterionProblems', () => {
  it('is empty for a workable rubric', () => {
    expect(criterionProblems([numeric('a', 1), numeric('b', 2)])).toEqual([])
  })

  it('names an unlabelled criterion', () => {
    const problems = criterionProblems([{ ...numeric('a', 1), label: '  ' }])
    expect(problems).toEqual([{ key: 'a', message: 'needs a label' }])
  })

  it('names a duplicate key', () => {
    const problems = criterionProblems([numeric('a', 1), numeric('a', 1)])
    expect(problems.some((problem) => problem.message === 'is listed twice')).toBe(true)
  })

  it('refuses a dropdown with one option', () => {
    const problems = criterionProblems([
      {
        key: 'a',
        label: 'A',
        kind: 'select',
        min: 1,
        max: 1,
        weight: 1,
        options: [{ label: 'Only', value: 1 }],
      },
    ])
    expect(problems[0].message).toContain('two options')
  })

  it('refuses a numeric criterion whose range is zero', () => {
    const problems = criterionProblems([{ ...numeric('a', 1), min: 3, max: 3 }])
    expect(problems[0].message).toContain('range of zero')
  })

  it('accepts a text criterion with no range, which is its normal shape', () => {
    expect(criterionProblems([newCriterionLabelled('text', 'Notes')])).toEqual([])
  })
})

describe('weightShares', () => {
  it('turns raw weights into the percentages an organizer thinks they are typing', () => {
    const shares = weightShares([numeric('a', 3), numeric('b', 1)])
    expect(shares.get('a')).toBeCloseTo(0.75)
    expect(shares.get('b')).toBeCloseTo(0.25)
  })

  it('agrees with what scoring.ts actually computes', () => {
    // The point of the number on screen: it has to be the same arithmetic. A perfect
    // score on `a` and the floor on `b` must come out at exactly a's share.
    const criteria = [numeric('a', 3), numeric('b', 1)]
    const scored = scoreReview({ scores: { a: 5, b: 1 } }, criteria)
    expect(scored.weightedMean).toBeCloseTo(weightShares(criteria).get('a') ?? 0)
  })

  it('gives a text criterion a zero share and leaves the rest at full weight', () => {
    const shares = weightShares([numeric('a', 1), newCriterionLabelled('text', 'Notes')])
    expect(shares.get('a')).toBe(1)
    expect(shares.get('notes')).toBe(0)
  })

  it('gives a select criterion a zero share even when it was saved with a nonzero weight', () => {
    // `newCriterion` and `normalizeCriterion` both force a select's weight to 0 now,
    // but a round saved before that rule existed can still hold a positive one until
    // its next save, and the editor has to show 0% for it right now regardless.
    const stale: Criterion = {
      key: 'recommendation',
      label: 'Recommendation',
      kind: 'select',
      min: 1,
      max: 3,
      weight: 5,
      options: [
        { label: 'Accept', value: 1 },
        { label: 'Reject', value: 3 },
      ],
    }
    const shares = weightShares([numeric('a', 1), stale])
    expect(shares.get('a')).toBe(1)
    expect(shares.get('recommendation')).toBe(0)
  })

  it('is all zero when nothing can contribute, rather than dividing by zero', () => {
    const shares = weightShares([numeric('a', 0), numeric('b', 0)])
    expect([...shares.values()]).toEqual([0, 0])
  })
})

describe('moveCriterion', () => {
  const list = [numeric('a', 1), numeric('b', 1), numeric('c', 1)]

  it('moves one place down', () => {
    expect(moveCriterion(list, 0, 1).map((item) => item.key)).toEqual(['b', 'a', 'c'])
  })

  it('moves one place up', () => {
    expect(moveCriterion(list, 2, -1).map((item) => item.key)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op off either end', () => {
    expect(moveCriterion(list, 0, -1)).toBe(list)
    expect(moveCriterion(list, 2, 1)).toBe(list)
  })
})

describe('scoring, with the new kinds', () => {
  it('does not score a dropdown, whatever range its options describe', () => {
    // Was: "scores a dropdown over the range its options describe", asserting a
    // weightedMean of 0.5 here. That assumed ascending option value meant ascending
    // favourability, which is exactly the assumption that inverted a Recommendation
    // dropdown's score (Accept=1/Maybe=2/Reject=3) in production. See scoring.ts's
    // `countedCriteria` and tests/scoring-select.test.ts for the full story.
    const criteria: readonly Criterion[] = [
      {
        key: 'delivery',
        label: 'Delivery',
        kind: 'select',
        min: 1,
        max: 3,
        weight: 1,
        options: [
          { label: 'Weak', value: 1 },
          { label: 'Fair', value: 2 },
          { label: 'Strong', value: 3 },
        ],
      },
    ]
    const scored = scoreReview({ scores: { delivery: 2 } }, criteria)
    expect(scored.weightedMean).toBeUndefined()
    expect(scored.usedCriteria).toBe(0)
  })

  it('ignores a stale score left behind when a criterion became free text', () => {
    // The migration case: an organizer converts a slider to a free-text box, and the
    // numbers already filed against that key must stop counting.
    const criteria = [newCriterionLabelled('text', 'Notes'), numeric('a', 1)]
    const scored = scoreReview({ scores: { notes: 5, a: 5 } }, criteria)
    expect(scored.usedCriteria).toBe(1)
    expect(scored.weightedMean).toBe(1)
  })
})

/** `newCriterion` plus a label, which is what the editor does on the next keystroke. */
function newCriterionLabelled(kind: 'numeric' | 'select' | 'text', label: string): Criterion {
  return { ...newCriterion(kind, label.toLowerCase()), label }
}
