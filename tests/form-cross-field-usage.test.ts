// The live combined counter's arithmetic.
//
// It has to agree with `validateCrossFieldLimits` exactly, or the counter says 480 / 500 while
// the wizard refuses to advance. Both count with `answerLength`, so the cases pinned here are
// the ones where the two could still disagree: a rule whose questions were deleted, a rule
// spanning a question the speaker has not answered, and the boundary between at and over.

import { describe, expect, it } from 'vitest'

import { combinedUsage } from '@/features/forms/cross-field-usage'
import { validateCrossFieldLimits } from '@/features/forms/validate'
import type { CrossFieldLimit, FormField } from '@/types/forms'

const TITLE: FormField = { id: 'f_title', type: 'text', label: 'Title', required: true }
const BLURB: FormField = { id: 'f_blurb', type: 'wysiwyg', label: 'Description', required: false }
const FIELDS: readonly FormField[] = [TITLE, BLURB]

const PROGRAM: readonly CrossFieldLimit[] = [
  { fieldIds: ['f_title', 'f_blurb'], maxLen: 20, perParticipant: false },
]

describe('combinedUsage', () => {
  it('sums the spanned answers and names the questions the budget is shared by', () => {
    expect(combinedUsage(PROGRAM, FIELDS, { f_title: 'Agents', f_blurb: 'that ship' })).toEqual([
      { labels: ['Title', 'Description'], used: 15, maxLen: 20, over: false },
    ])
  })

  it('counts an unanswered question as nothing rather than dropping the rule', () => {
    expect(combinedUsage(PROGRAM, FIELDS, { f_title: 'Agents' }).at(0)?.used).toBe(6)
  })

  it('is not over at exactly the cap, which is where the wizard also still advances', () => {
    const answers = { f_title: 'a'.repeat(12), f_blurb: 'b'.repeat(8) }

    expect(combinedUsage(PROGRAM, FIELDS, answers).at(0)?.over).toBe(false)
    expect(validateCrossFieldLimits(PROGRAM, answers)).toEqual([])
  })

  it('flags over by one, and the validator reports it at the same character', () => {
    const answers = { f_title: 'a'.repeat(13), f_blurb: 'b'.repeat(8) }

    expect(combinedUsage(PROGRAM, FIELDS, answers).at(0)).toEqual({
      labels: ['Title', 'Description'],
      used: 21,
      maxLen: 20,
      over: true,
    })
    expect(validateCrossFieldLimits(PROGRAM, answers)).toHaveLength(1)
  })

  it('renders no counter for a rule whose questions are all gone from the form', () => {
    expect(combinedUsage(PROGRAM, [], { f_title: 'Agents' })).toEqual([])
  })

  it('still counts a rule that lost one of its questions, over what is left', () => {
    // Deliberately not dropped: the remaining question is still capped by the rule the
    // wizard is about to enforce, so hiding the counter would hide the enforcement.
    expect(combinedUsage(PROGRAM, [TITLE], { f_title: 'Agents' }).at(0)).toEqual({
      labels: ['Title'],
      used: 6,
      maxLen: 20,
      over: false,
    })
  })

  it('gives one entry per rule, in the order they were authored', () => {
    const limits: readonly CrossFieldLimit[] = [
      ...PROGRAM,
      { fieldIds: ['f_title', 'f_blurb'], maxLen: 5, perParticipant: false },
    ]

    expect(
      combinedUsage(limits, FIELDS, { f_title: 'Agents' }).map((usage) => usage.maxLen),
    ).toEqual([20, 5])
  })
})
