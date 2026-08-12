// The 3-step portal form wizard: its defaults, its footer gating, and the checks it saves under.

import { describe, expect, it } from 'vitest'

import { hasBlockingProblem } from '@/features/forms/builder/checks'
import type { FormDraft } from '@/features/forms/builder/draft'
import { toFormWrite } from '@/features/forms/builder/draft'
import {
  checkPortalFormDraft,
  DEFAULT_PORTAL_CONFIRMATION_HTML,
  DEFAULT_PORTAL_WELCOME_HTML,
  isPortalStepComplete,
  newPortalFormDraft,
  PORTAL_FORM_TYPE_CARDS,
} from '@/features/portal-forms/form-draft'
import type { FormField } from '@/types/forms'

const TZ = 'America/Los_Angeles'

const question: FormField = { id: 'q_name', type: 'text', label: 'Preferred name', required: true }

function withQuestion(overrides: Partial<FormDraft> = {}): FormDraft {
  return { ...newPortalFormDraft('Speaker Contact Form'), fields: [question], ...overrides }
}

describe('newPortalFormDraft', () => {
  it('opens on Contacts, with the participants step off and no routing', () => {
    const draft = newPortalFormDraft()

    expect(draft.entityType).toBe('contact')
    expect(draft.participantsEnabled).toBe(false)
    expect(draft.routing).toEqual({ rules: [], defaultTrackId: undefined })
    expect(draft.roles).toEqual([])
  })

  it('seeds no questions, because a portal answer writes to no typed column', () => {
    expect(newPortalFormDraft().fields).toEqual([])
  })

  it('carries the transcribed step 2 body and the confirmation email on by default', () => {
    const draft = newPortalFormDraft()

    expect(draft.welcomeHtml).toBe(DEFAULT_PORTAL_WELCOME_HTML)
    expect(draft.confirmationEmailEnabled).toBe(true)
    expect(draft.confirmationEmailHtml).toBe(DEFAULT_PORTAL_CONFIRMATION_HTML)
  })

  it('survives toFormWrite with its type intact and its participant step dropped', () => {
    const write = toFormWrite(withQuestion(), TZ)

    expect(write.entityType).toBe('contact')
    expect(write.participantsEnabled).toBe(false)
    expect(write.welcomeHtml).toBe(DEFAULT_PORTAL_WELCOME_HTML)
    expect(write.fields.map((entry) => entry.label)).toEqual(['Preferred name'])
  })
})

describe('PORTAL_FORM_TYPE_CARDS', () => {
  it('offers only the two types that can be built, in ref 27s order', () => {
    expect(PORTAL_FORM_TYPE_CARDS.map((card) => card.entityType)).toEqual(['contact', 'submission'])
    expect(PORTAL_FORM_TYPE_CARDS.map((card) => card.label)).toEqual(['Contacts', 'Submissions'])
  })

  it('does not offer Groups at all, rather than offering it dimmed', () => {
    // Carried as a permanently disabled tile until 2026-08-10, because ref 27 dims it too.
    // What that offered was an entity type with no table in BUILD_SPEC 3, switched off
    // pending nothing: a tile an organizer can read and never pick. If a Groups module is
    // ever built it comes back enabled, and this assertion is what should fail first.
    expect(PORTAL_FORM_TYPE_CARDS.map((card) => card.entityType)).not.toContain('group')
  })
})

describe('isPortalStepComplete', () => {
  it('gates step 1 on a name and a type', () => {
    expect(isPortalStepComplete(newPortalFormDraft(), 1)).toBe(false)
    expect(isPortalStepComplete(newPortalFormDraft('  '), 1)).toBe(false)
    expect(isPortalStepComplete(newPortalFormDraft('Speaker Contact Form'), 1)).toBe(true)
    expect(isPortalStepComplete({ ...newPortalFormDraft('Named'), entityType: undefined }, 1)).toBe(
      false,
    )
  })

  it('gates step 2 on at least one question', () => {
    expect(isPortalStepComplete(newPortalFormDraft('Named'), 2)).toBe(false)
    expect(isPortalStepComplete(withQuestion(), 2)).toBe(true)
  })

  it('never gates step 3, which has no required field', () => {
    expect(isPortalStepComplete(newPortalFormDraft(), 3)).toBe(true)
  })
})

describe('checkPortalFormDraft', () => {
  it('passes a named, typed form with one question', () => {
    expect(checkPortalFormDraft(withQuestion())).toEqual([])
  })

  it('refuses a form with no name, through the shared check', () => {
    const messages = checkPortalFormDraft(withQuestion({ name: '' })).map(
      (problem) => problem.message,
    )

    expect(messages).toContain('Internal Form Name is required.')
  })

  it('refuses a form with no type', () => {
    const problems = checkPortalFormDraft(withQuestion({ entityType: undefined }))

    expect(problems.map((problem) => problem.message)).toContain(
      'Choose what type of form this is.',
    )
  })

  it('warns rather than refuses on a form with no questions, so it can be left half-built', () => {
    const problems = checkPortalFormDraft(withQuestion({ fields: [] }))
    const noQuestions = problems.filter((problem) => problem.message.includes('no questions yet'))

    expect(noQuestions).toHaveLength(1)
    expect(noQuestions.at(0)?.severity).toBe('warning')
    expect(hasBlockingProblem(problems)).toBe(false)
  })

  it('blocks on a missing type, which is a required field rather than a gap', () => {
    expect(hasBlockingProblem(checkPortalFormDraft(withQuestion({ entityType: undefined })))).toBe(
      true,
    )
  })

  it('inherits the shared rule against a required choice question with no options', () => {
    const empty: FormField = { id: 'q_pick', type: 'select', label: 'Pick one', required: true }
    const problems = checkPortalFormDraft(withQuestion({ fields: [empty] }))

    expect(problems.map((problem) => problem.message)).toContain(
      'Pick one is a choice question with no options.',
    )
  })

  it('inherits the shared rule against a condition on a question asked later', () => {
    const later: FormField = {
      id: 'q_detail',
      type: 'text',
      label: 'Tell us more',
      required: false,
      showIf: { fieldId: 'q_diet', op: 'eq', value: 'vegan' },
    }
    const controller: FormField = {
      id: 'q_diet',
      type: 'select',
      label: 'Diet',
      required: false,
      options: [{ value: 'vegan', label: 'Vegan' }],
    }
    const problems = checkPortalFormDraft(withQuestion({ fields: [later, controller] }))

    expect(problems.some((problem) => problem.message.includes('is not asked before it'))).toBe(
      true,
    )
  })

  it('raises no participant or role problem, because that step is off', () => {
    const problems = checkPortalFormDraft(withQuestion())

    expect(problems.some((problem) => problem.message.includes('role'))).toBe(false)
  })
})
