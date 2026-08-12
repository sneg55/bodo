// A form task's answers: the trip in from `answersJson`, the trip out to storage, and the one
// rule that differs between saving progress and completing.

import { describe, expect, it } from 'vitest'
import { validateAnswers } from '@/features/forms/validate'
import {
  answersForFields,
  answersToStore,
  partialAnswerProblems,
} from '@/features/portal-forms/answers'
import type { FormField } from '@/types/forms'

const FIELDS: readonly FormField[] = [
  { id: 'q_name', type: 'text', label: 'Preferred name', required: true },
  { id: 'q_email', type: 'email', label: 'Contact email', required: false },
  {
    id: 'q_diet',
    type: 'select',
    label: 'Dietary requirements',
    required: false,
    options: [
      { value: 'none', label: 'None' },
      { value: 'vegan', label: 'Vegan' },
    ],
  },
  {
    id: 'q_detail',
    type: 'text',
    label: 'Tell us more',
    required: true,
    showIf: { fieldId: 'q_diet', op: 'eq', value: 'vegan' },
  },
]

describe('answersForFields', () => {
  it('answers nothing when the assignment has never been saved', () => {
    expect(answersForFields(FIELDS, undefined)).toEqual({})
  })

  it('answers nothing for a form with zero fields', () => {
    expect(answersForFields([], { q_name: 'Ada' })).toEqual({})
  })

  it('answers nothing when the linked form is gone, which reads here as no fields', () => {
    expect(answersForFields([], { q_name: 'Ada', q_email: 'ada@example.com' })).toEqual({})
  })

  it('drops an answer whose question is no longer on the form', () => {
    const stored = { q_name: 'Ada', q_removed: 'answered before the question was deleted' }

    expect(answersForFields(FIELDS, stored)).toEqual({ q_name: 'Ada' })
  })

  it('keeps a hidden conditional answer, because the controller is still being decided', () => {
    const stored = { q_diet: 'none', q_detail: 'typed while vegan was selected' }

    expect(answersForFields(FIELDS, stored)).toEqual(stored)
  })

  it('keeps a false checkbox, which is a cleared answer rather than no answer', () => {
    const fields: readonly FormField[] = [
      { id: 'q_ok', type: 'checkbox', label: 'I agree', required: false },
    ]

    expect(answersForFields(fields, { q_ok: false })).toEqual({ q_ok: false })
  })
})

describe('partialAnswerProblems', () => {
  it('allows a required question left blank, which is the whole point of a save', () => {
    expect(partialAnswerProblems(FIELDS, {})).toEqual([])
    expect(partialAnswerProblems(FIELDS, { q_email: 'ada@example.com' })).toEqual([])
  })

  it('still refuses a badly formed answer that was filled in', () => {
    const problems = partialAnswerProblems(FIELDS, { q_email: 'not-an-email' })

    expect(problems.map((problem) => problem.code)).toEqual(['email_invalid'])
  })

  it('still refuses an option the question no longer offers', () => {
    const problems = partialAnswerProblems(FIELDS, { q_diet: 'pescatarian' })

    expect(problems.map((problem) => problem.code)).toEqual(['option_invalid'])
  })

  it('ignores a blank required question that a condition has made visible', () => {
    // `q_detail` is required and visible once `q_diet` is vegan. A COMPLETE must refuse this
    // and a SAVE must not, which is the pair the two functions exist to separate.
    const answers = { q_diet: 'vegan' }

    expect(validateAnswers(FIELDS, answers).map((problem) => problem.fieldId)).toEqual([
      'q_name',
      'q_detail',
    ])
    expect(partialAnswerProblems(FIELDS, answers)).toEqual([])
  })

  it('does not report a blank required question that a condition has hidden', () => {
    expect(validateAnswers(FIELDS, { q_diet: 'none', q_name: 'Ada' })).toEqual([])
    expect(partialAnswerProblems(FIELDS, { q_diet: 'none', q_name: 'Ada' })).toEqual([])
  })
})

describe('answersToStore', () => {
  it('strips an answer to a question the condition has since hidden', () => {
    const stored = answersToStore(FIELDS, {
      q_name: 'Ada',
      q_diet: 'none',
      q_detail: 'typed while vegan was selected',
    })

    expect(stored).toEqual({ q_name: 'Ada', q_diet: 'none' })
  })

  it('strips a key that names no question on this form', () => {
    expect(answersToStore(FIELDS, { q_name: 'Ada', injected: 'from a forged post' })).toEqual({
      q_name: 'Ada',
    })
  })

  it('stores nothing for a form with no fields', () => {
    expect(answersToStore([], { q_name: 'Ada' })).toEqual({})
  })
})
