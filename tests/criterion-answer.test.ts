// A dropdown criterion stores the NUMBER its option carries. These assert the way back:
// the reviewer's Select trigger and the organizer's Reviews block both read a stored score
// through this module, and both printed a bare `1` under a criterion named "Recommendation"
// before it existed.

import { describe, expect, it } from 'vitest'

import {
  criterionOptionLabel,
  criterionScoreText,
  criterionSelectItems,
} from '@/features/review/criterion-answer'
import type { Criterion } from '@/types/domain'

/** The rubric the eval run built: Accept is option one, so its stored score is 1. */
const RECOMMENDATION: Criterion = {
  key: 'recommendation',
  label: 'Recommendation',
  kind: 'select',
  min: 1,
  max: 3,
  weight: 1,
  options: [
    { label: 'Accept', value: 1 },
    { label: 'Maybe', value: 2 },
    { label: 'Reject', value: 3 },
  ],
}

const ORIGINALITY: Criterion = {
  key: 'originality',
  label: 'Originality',
  kind: 'numeric',
  min: 1,
  max: 5,
  weight: 1,
}

const COMMENTS: Criterion = {
  key: 'comments',
  label: 'Comments',
  kind: 'text',
  min: 0,
  max: 0,
  weight: 0,
}

describe('criterionOptionLabel', () => {
  it('resolves a stored score back to the option the reviewer picked', () => {
    expect(criterionOptionLabel(RECOMMENDATION, 1)).toBe('Accept')
    expect(criterionOptionLabel(RECOMMENDATION, 3)).toBe('Reject')
  })

  it('has no label for a score no option carries', () => {
    // An organizer who renumbered the options after reviews landed. Guessing here would
    // report a verdict the reviewer never gave.
    expect(criterionOptionLabel(RECOMMENDATION, 7)).toBeUndefined()
  })

  it('has no label for kinds that carry no options', () => {
    expect(criterionOptionLabel(ORIGINALITY, 4)).toBeUndefined()
    expect(criterionOptionLabel(COMMENTS, 0)).toBeUndefined()
    // `options` is optional on the type, so a select saved before the field existed must
    // not throw inside the cached read this runs in.
    expect(criterionOptionLabel({ ...RECOMMENDATION, options: undefined }, 1)).toBeUndefined()
  })

  it('treats an empty option label as no label at all', () => {
    const blank: Criterion = { ...RECOMMENDATION, options: [{ label: '', value: 1 }] }
    expect(criterionOptionLabel(blank, 1)).toBeUndefined()
  })
})

describe('criterionSelectItems', () => {
  it('keys the map by the STRING score, which is what the Select is controlled by', () => {
    expect(criterionSelectItems(RECOMMENDATION)).toEqual({
      '1': 'Accept',
      '2': 'Maybe',
      '3': 'Reject',
    })
  })

  it('is empty for a criterion with no options', () => {
    expect(criterionSelectItems(ORIGINALITY)).toEqual({})
  })
})

describe('criterionScoreText', () => {
  it('prints a dropdown as its label, not as its score over the range', () => {
    expect(criterionScoreText(RECOMMENDATION, 1)).toBe('Accept')
  })

  it('prints an unmatched dropdown score bare, never over its derived range', () => {
    // A select's min/max come from its options, so `7/3` would describe a scale the
    // reviewer was never shown.
    expect(criterionScoreText(RECOMMENDATION, 7)).toBe('7')
  })

  it('keeps value over max for a slider, where the ceiling is what gives it meaning', () => {
    expect(criterionScoreText(ORIGINALITY, 4)).toBe('4/5')
  })
})
