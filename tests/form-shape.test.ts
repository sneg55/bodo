// Shape validation exists because the public CFP submit is an open POST endpoint
// (BUILD_SPEC section 5.1: the server re-validates on submit). The wizard cannot
// send a checkbox as the string "false" or a multiselect as a scalar, but curl
// can, so every case here is a tampered payload rather than a mistyped answer.
//
// It has to run before content validation: asking whether `['ai']` is one of a
// dropdown's declared options answers a question nobody asked, and the answer it
// gives ("yes, ai is an option") lets the wrong-typed value through.

import { describe, expect, it } from 'vitest'

import { checkShape } from '@/features/forms/shape-checks'
import { type Problem, ProblemCodes, validateAnswers } from '@/features/forms/validate'
import type { FormField } from '@/types/forms'

function codes(problems: readonly Problem[]): readonly string[] {
  return problems.map((problem) => problem.code)
}

/** One field, one answer, straight through the same entry point submit uses. */
function submit(field: FormField, answer: unknown): readonly string[] {
  return codes(validateAnswers([field], { [field.id]: answer }))
}

function field(type: FormField['type'], extra: Partial<FormField> = {}): FormField {
  return { id: 'f', type, label: type, required: false, ...extra }
}

describe('checkbox shape', () => {
  const consent = field('checkbox', { label: 'Terms', required: true })

  it('rejects the string false, which reads as a given consent today', () => {
    // `isAnswered` only knows about boolean `false`, so "false" arrives as a
    // consent that was never given.
    expect(submit(consent, 'false')).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('rejects the string true as well, so a checkbox is never a string', () => {
    expect(submit(consent, 'true')).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('rejects a number standing in for a checkbox', () => {
    expect(submit(consent, 1)).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('accepts a real boolean', () => {
    expect(submit(consent, true)).toEqual([])
  })
})

describe('multiselect and single-choice cardinality', () => {
  const options = [
    { value: 'ai', label: 'AI' },
    { value: 'sec', label: 'Security' },
  ]

  it('rejects a multiselect submitted as a scalar', () => {
    const tags = field('multiselect', { label: 'Tags', options })

    expect(submit(tags, 'ai')).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(tags, ['ai', 'sec'])).toEqual([])
  })

  it('rejects a multiselect whose members are not strings', () => {
    const tags = field('multiselect', { label: 'Tags' })

    expect(submit(tags, [1, 2])).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(tags, ['ai', null])).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('rejects a select submitted as an array', () => {
    const format = field('select', { label: 'Format', options })

    expect(submit(format, ['ai'])).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(format, 'ai')).toEqual([])
  })

  it('rejects a radio submitted as an array', () => {
    const level = field('radio', { label: 'Level', options })

    expect(submit(level, ['ai', 'sec'])).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(level, 'sec')).toEqual([])
  })
})

describe('datetime shape', () => {
  const startsAt = field('datetime', { label: 'Starts At' })

  it('rejects a value that is not a parseable timestamp', () => {
    expect(submit(startsAt, 'not-a-date')).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(startsAt, '2026-13-45T99:00:00Z')).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('rejects a datetime submitted as an array', () => {
    expect(submit(startsAt, ['2026-10-12T17:00:00.000Z'])).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('accepts an ISO instant and a plain date', () => {
    expect(submit(startsAt, '2026-10-12T17:00:00.000Z')).toEqual([])
    expect(submit(startsAt, '2026-10-12')).toEqual([])
  })
})

describe('number shape', () => {
  const credits = field('number', { label: 'CEU Credits' })

  it('rejects a boolean and an array, which read as numbers once flattened', () => {
    // `answerValues` stringifies both, so the old format check saw "true" and
    // "30" rather than the wrong type it actually got.
    expect(submit(credits, true)).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(credits, ['30'])).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('rejects a string that only Number() would accept', () => {
    // A hex literal or an exponent is not something a number input produces, and
    // Number('0x10') is 16, so the old finite check passed it.
    expect(submit(credits, '0x10')).toEqual([ProblemCodes.NUMBER_INVALID])
    expect(submit(credits, '1e3')).toEqual([ProblemCodes.NUMBER_INVALID])
    expect(submit(credits, 'not a number')).toEqual([ProblemCodes.NUMBER_INVALID])
  })

  it('rejects a non-finite number', () => {
    expect(submit(credits, Number.POSITIVE_INFINITY)).toEqual([ProblemCodes.SHAPE_INVALID])
    expect(submit(credits, Number.NaN)).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('accepts a finite number and a canonical numeric string', () => {
    expect(submit(credits, 1.5)).toEqual([])
    expect(submit(credits, '-2')).toEqual([])
    expect(submit(credits, '0.25')).toEqual([])
  })
})

describe('text-shaped types', () => {
  it('rejects a non-string for every type whose answer is text', () => {
    for (const type of ['text', 'wysiwyg', 'email', 'phone', 'url', 'video'] as const) {
      expect(submit(field(type), 42)).toEqual([ProblemCodes.SHAPE_INVALID])
      expect(submit(field(type), ['a', 'b'])).toEqual([ProblemCodes.SHAPE_INVALID])
    }
  })

  it('still applies the format check to a well-shaped string', () => {
    expect(submit(field('email'), 'speaker@example.com')).toEqual([])
    expect(submit(field('email'), 'speaker at example.com')).toEqual([ProblemCodes.EMAIL_INVALID])
  })
})

describe('shape runs before content validation', () => {
  it('does not report option membership for a value of the wrong type', () => {
    const format = field('select', {
      label: 'Format',
      options: [{ value: 'talk', label: 'Talk' }],
    })

    // `['talk']` is a member of the option set and still the wrong shape. One
    // problem, and it names the real mistake.
    expect(submit(format, ['talk'])).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('does not report a length cap for a value of the wrong type', () => {
    const title = field('text', { label: 'Title', maxLen: 3 })

    expect(submit(title, ['aaaa', 'bbbb'])).toEqual([ProblemCodes.SHAPE_INVALID])
  })

  it('leaves a hidden field unchecked, shape included', () => {
    const fields: readonly FormField[] = [
      { id: 'format', type: 'select', label: 'Format', required: false },
      {
        id: 'seats',
        type: 'number',
        label: 'Seats',
        required: false,
        showIf: { fieldId: 'format', op: 'eq', value: 'workshop' },
      },
    ]

    expect(validateAnswers(fields, { format: 'talk', seats: true })).toEqual([])
  })
})

describe('checkShape directly', () => {
  it('checks nothing for an upload, whose answer shape belongs to the upload flow', () => {
    // A file answer is a reference written by the R2 upload path, not something a
    // speaker types, and a non-string object is already treated as unanswered.
    expect(checkShape(field('file'), 'files/abc.pdf')).toEqual([])
    expect(checkShape(field('speaker_headshot'), 'files/head.png')).toEqual([])
  })

  it('attributes the problem to the field that caused it', () => {
    const problems = checkShape(field('checkbox', { id: 'terms', label: 'Terms' }), 'false')

    expect(problems[0]?.fieldId).toBe('terms')
    expect(problems[0]?.message).toContain('Terms')
  })
})
