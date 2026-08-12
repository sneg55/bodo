// What blocks each step, and the recap the Review step reads.
//
// The property worth pinning is agreement with the server: these run the same
// `visibleFields` and `validateParticipants` that `prepareSubmission` runs, so a step
// that lets the speaker press Submit and a server that refuses it cannot drift apart.

import { describe, expect, it } from 'vitest'

import { ProblemCodes } from '@/features/forms/validate'
import type { PublicForm } from '@/features/submissions/public-form'
import {
  accountProblems,
  answeredSummary,
  participantLabel,
  stepProblems,
  submissionProblems,
  submitProblems,
} from '@/features/submissions/wizard-gating'
import {
  initialWizardState,
  newParticipant,
  type WizardState,
} from '@/features/submissions/wizard-state'

import { CFP_FIELDS, CFP_PARTICIPANT_FIELDS } from './helpers/cfp-form'

const FORM: PublicForm = {
  publicId: 'pub1',
  eventSlug: 'ai-engineer-sandbox',
  eventName: 'AI Engineer Sandbox',
  name: 'Call for Speakers',
  entityKind: 'abstracts',
  participantsEnabled: true,
  fields: CFP_FIELDS,
  participantFields: CFP_PARTICIPANT_FIELDS,
  roles: [
    { role: 'speaker', enabled: true, min: 1, max: 1 },
    { role: 'co_speaker', enabled: true, min: 0, max: 4 },
  ],
  crossFieldLimits: [],
  autoRedirectToPortal: false,
}

function ready(): WizardState {
  return {
    ...initialWizardState(),
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    answers: { f_title: 'Agents that ship', f_format: 'talk' },
    participants: [
      newParticipant({
        role: 'speaker',
        isPrimary: true,
        firstName: 'Ada',
        lastName: 'Okafor',
        email: 'ada@example.com',
      }),
    ],
  }
}

describe('accountProblems', () => {
  it('is empty for an email and a name', () => {
    expect(accountProblems(ready())).toEqual([])
  })

  it('asks for the three values by their parity labels', () => {
    const messages = accountProblems(initialWizardState()).map((problem) => problem.message)
    expect(messages).toEqual([
      'Your Email Address is required.',
      'First Name is required.',
      'Last Name is required.',
    ])
  })

  it('rejects an address that is not an address', () => {
    const problems = accountProblems({ ...ready(), email: 'ada at example' })
    expect(problems.map((problem) => problem.code)).toEqual([ProblemCodes.EMAIL_INVALID])
  })
})

describe('submissionProblems', () => {
  it('is empty once the visible required questions are answered', () => {
    expect(submissionProblems(FORM, ready())).toEqual([])
  })

  it('does not ask for a question the current answers hide', () => {
    // f_lab is required but only visible for a workshop.
    const problems = submissionProblems(FORM, ready())
    expect(problems.map((problem) => problem.fieldId)).not.toContain('f_lab')
  })

  it('asks for it as soon as the condition holds', () => {
    const state = { ...ready(), answers: { f_title: 'T', f_format: 'workshop' } }
    expect(submissionProblems(FORM, state).map((problem) => problem.fieldId)).toContain('f_lab')
  })

  it('reports a submission-level combined limit but leaves the per-participant ones alone', () => {
    const form: PublicForm = {
      ...FORM,
      crossFieldLimits: [
        { fieldIds: ['f_title'], maxLen: 3, perParticipant: false },
        { fieldIds: ['p_bio'], maxLen: 1, perParticipant: true },
      ],
    }
    expect(submissionProblems(form, ready())).toHaveLength(1)
  })
})

describe('stepProblems', () => {
  it('never blocks the Welcome step, which asks nothing', () => {
    expect(stepProblems(FORM, initialWizardState(), 'welcome')).toEqual([])
  })

  it('accepts a solo speaker on the Participant step', () => {
    expect(stepProblems(FORM, ready(), 'participant')).toEqual([])
  })

  it('reports a participant with no email against their own row', () => {
    const state = ready()
    const stripped = {
      ...state,
      participants: [{ ...state.participants[0], email: '' }],
    }
    const problems = stepProblems(FORM, stripped, 'participant')
    expect(problems.every((problem) => problem.participantId === state.participants[0].key)).toBe(
      true,
    )
  })

  it('has no participant problems at all when participants are off', () => {
    const soloForm: PublicForm = { ...FORM, participantsEnabled: false }
    expect(stepProblems(soloForm, { ...ready(), participants: [] }, 'participant')).toEqual([])
  })

  it('gates Review on everything behind it, so Submit and Next cannot disagree', () => {
    expect(stepProblems(FORM, ready(), 'review')).toEqual([])
    expect(submitProblems(FORM, initialWizardState()).length).toBeGreaterThan(0)
  })
})

describe('the Review recap', () => {
  it('lists answered visible questions in the form order and drops the rest', () => {
    const summary = answeredSummary(
      CFP_FIELDS.map((field) => ({ id: field.id, label: field.label })),
      { f_format: 'talk', f_title: 'Agents that ship', f_notes: '   ' },
      CFP_FIELDS.filter((field) => field.id !== 'f_lab'),
    )
    expect(summary.map((entry) => entry.id)).toEqual(['f_title', 'f_format'])
  })

  it('omits an answer to a question that is currently hidden', () => {
    const summary = answeredSummary(
      CFP_FIELDS.map((field) => ({ id: field.id, label: field.label })),
      { f_title: 'T', f_format: 'talk', f_lab: 'left over' },
      CFP_FIELDS.filter((field) => field.id !== 'f_lab'),
    )
    expect(summary.map((entry) => entry.id)).not.toContain('f_lab')
  })

  it('names a participant by name, then email, then something locatable', () => {
    expect(
      participantLabel(newParticipant({ role: 'speaker', isPrimary: true, firstName: 'Ada' })),
    ).toBe('Ada')
    expect(
      participantLabel(newParticipant({ role: 'speaker', isPrimary: true, email: 'a@b.co' })),
    ).toBe('a@b.co')
    expect(participantLabel(newParticipant({ role: 'speaker', isPrimary: true }))).toBe(
      'this participant',
    )
  })
})
