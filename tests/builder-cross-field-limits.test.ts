// Cross-field character limits, from the authoring side.
//
// `tests/form-validate.test.ts` already pins what the public wizard DOES with a stored rule
// (sums the named fields, reports over budget, measures a `perParticipant` rule inside each
// participant's own answers). This file pins the other half, which had no authoring UI at
// all until now: whether the rule the organizer wrote is a rule.
//
// Every case here is silent on the public form rather than reported there.
// `validateCrossFieldLimits` sums whatever ids it is handed and finds nothing, so a rule
// spanning one field, or a field that has been deleted, caps nothing while the organizer
// believes it does. That is the whole reason these are errors and not warnings.

import { describe, expect, it } from 'vitest'

import { checkCrossFieldLimits } from '@/features/forms/builder/checks'
import { limitableFields } from '@/features/forms/builder/field-ops'
import type { CrossFieldLimit, FormField } from '@/types/forms'

const TITLE: FormField = {
  id: 'f_title',
  type: 'text',
  label: 'Title',
  required: true,
  maxLen: 255,
}
const DESCRIPTION: FormField = {
  id: 'f_desc',
  type: 'wysiwyg',
  label: 'Description',
  required: true,
  maxLen: 5000,
}
const FORMAT: FormField = {
  id: 'f_format',
  type: 'select',
  label: 'Format',
  required: true,
  options: [{ value: 'talk', label: 'Talk' }],
}
const BIO: FormField = { id: 'p_bio', type: 'speaker_bio', label: 'Biography', required: false }
const HEADLINE: FormField = { id: 'p_role', type: 'text', label: 'Job title', required: false }

const FIELDS: readonly FormField[] = [TITLE, DESCRIPTION, FORMAT]
const PARTICIPANT_FIELDS: readonly FormField[] = [BIO, HEADLINE]

function check(limits: readonly CrossFieldLimit[]) {
  return checkCrossFieldLimits(limits, FIELDS, PARTICIPANT_FIELDS, 6)
}

function messages(problems: readonly { message: string }[]): string {
  return problems.map((problem) => problem.message).join(' | ')
}

describe('checkCrossFieldLimits', () => {
  it('accepts a printed-program rule over two submission questions', () => {
    expect(
      check([{ fieldIds: ['f_title', 'f_desc'], maxLen: 500, perParticipant: false }]),
    ).toEqual([])
  })

  it('accepts a per-participant rule over two participant questions', () => {
    expect(check([{ fieldIds: ['p_bio', 'p_role'], maxLen: 800, perParticipant: true }])).toEqual(
      [],
    )
  })

  it('rejects a rule over one field, which is that field’s own limit twice over', () => {
    const problems = check([{ fieldIds: ['f_title'], maxLen: 255, perParticipant: false }])

    expect(messages(problems)).toContain('at least two questions')
    expect(problems.at(0)?.severity).toBe('error')
    // Authored on step 6, so that is where the organizer is sent to fix it.
    expect(problems.at(0)?.step).toBe(6)
  })

  it('rejects a rule with no fields at all', () => {
    expect(messages(check([{ fieldIds: [], maxLen: 500, perParticipant: false }]))).toContain(
      'at least two questions',
    )
  })

  it('rejects a cap of zero, which no answer satisfies', () => {
    const problems = check([{ fieldIds: ['f_title', 'f_desc'], maxLen: 0, perParticipant: false }])

    expect(messages(problems)).toContain('is not a limit')
    expect(problems).toHaveLength(1)
  })

  it('rejects a negative cap the same way', () => {
    expect(
      messages(check([{ fieldIds: ['f_title', 'f_desc'], maxLen: -5, perParticipant: false }])),
    ).toContain('is not a limit')
  })

  it('reports both faults of a one-field rule with a zero cap', () => {
    expect(check([{ fieldIds: ['f_title'], maxLen: 0, perParticipant: false }])).toHaveLength(2)
  })

  it('rejects a rule spanning a question that has been deleted', () => {
    const problems = check([
      { fieldIds: ['f_title', 'f_gone'], maxLen: 500, perParticipant: false },
    ])

    expect(messages(problems)).toContain('a question that is not among')
  })

  it('rejects a submission rule that reaches into the participant questions', () => {
    // The wizard measures a non-participant rule against the submission's own answers, so a
    // participant field id in it sums to nothing at all.
    const problems = check([{ fieldIds: ['f_title', 'p_bio'], maxLen: 500, perParticipant: false }])

    expect(messages(problems)).toContain("this form's submission questions")
  })

  it('rejects a per-participant rule that reaches into the submission questions', () => {
    const problems = check([{ fieldIds: ['p_bio', 'f_title'], maxLen: 500, perParticipant: true }])

    expect(messages(problems)).toContain("this form's participant questions")
  })

  it('rejects the same question named twice, which double-counts one answer', () => {
    const problems = check([
      { fieldIds: ['f_title', 'f_title'], maxLen: 500, perParticipant: false },
    ])

    expect(messages(problems)).toContain('the same question twice')
  })

  it('checks every rule, not just the first broken one', () => {
    const problems = check([
      { fieldIds: ['f_title'], maxLen: 500, perParticipant: false },
      { fieldIds: ['f_title', 'f_desc'], maxLen: 0, perParticipant: false },
    ])

    expect(problems).toHaveLength(2)
  })

  it('says nothing when there are no rules, which is the default', () => {
    expect(check([])).toEqual([])
  })
})

describe('limitableFields', () => {
  it('offers the questions whose answers are text the product counts characters for', () => {
    expect(limitableFields(FIELDS).map((field) => field.id)).toEqual(['f_title', 'f_desc'])
  })

  it('leaves out a choice question, whose length is an option value nobody typed', () => {
    expect(limitableFields([FORMAT])).toEqual([])
  })

  it('includes a Biography, which is the speaker field the reference calls out', () => {
    expect(limitableFields(PARTICIPANT_FIELDS).map((field) => field.id)).toEqual([
      'p_bio',
      'p_role',
    ])
  })
})
