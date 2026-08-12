// The wizard's localStorage copy: the format it survives a reload in, and whether what came
// back counts as a draft to announce.
//
// A stored blob outlives the code that wrote it, so `parseWizardState` has to reject anything
// that is not a state this build wrote rather than let a half object into the wizard: losing
// one unsent draft is recoverable, rendering a wizard with no participants array is not.
//
// The public wizard also says when it has put a draft back and offers to start over, and the
// notice is only honest if "there is a draft" is decided precisely. The wizard persists on
// every change, including the one that clears everything, so "localStorage has a value" is
// not the same question.

import { describe, expect, it } from 'vitest'

import { PARTICIPANT_ROLES } from '@/constants/status'
import type { PublicForm } from '@/features/submissions/public-form'
import {
  isEmptyWizardState,
  parseWizardState,
  serializeWizardState,
} from '@/features/submissions/wizard-draft'
import {
  initialWizardState,
  newParticipant,
  seedPrimaryParticipant,
  setAnswer,
} from '@/features/submissions/wizard-state'

const FORM: Pick<PublicForm, 'participantsEnabled' | 'roles'> = {
  participantsEnabled: true,
  roles: [
    { role: 'speaker', enabled: true, min: 1, max: 1 },
    { role: 'co_speaker', enabled: true, min: 0, max: 4 },
  ],
}

function filled() {
  return {
    ...initialWizardState(),
    step: 'participant' as const,
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Okafor',
  }
}

describe('isEmptyWizardState', () => {
  it('treats a freshly cleared wizard as no draft at all', () => {
    expect(isEmptyWizardState(initialWizardState())).toBe(true)
  })

  it('counts a typed email as a draft', () => {
    expect(isEmptyWizardState({ ...initialWizardState(), email: 'ada@example.com' })).toBe(false)
  })

  it('counts one answered question as a draft', () => {
    expect(isEmptyWizardState(setAnswer(initialWizardState(), 'f1', 'A taxonomy'))).toBe(false)
  })

  it('counts having reached a later step as a draft, with nothing typed', () => {
    expect(isEmptyWizardState({ ...initialWizardState(), step: 'review' })).toBe(false)
  })

  it('counts a seeded participant row as a draft', () => {
    const state = {
      ...initialWizardState(),
      participants: [newParticipant({ role: 'speaker', isPrimary: true })],
    }

    expect(isEmptyWizardState(state)).toBe(false)
  })
})

describe('parseWizardState', () => {
  it('round-trips a state through serialize', () => {
    const state = seedPrimaryParticipant(filled(), FORM)
    expect(parseWizardState(serializeWizardState(state))).toEqual(state)
  })

  it('is undefined for nothing stored', () => {
    expect(parseWizardState(null)).toBeUndefined()
    expect(parseWizardState(undefined)).toBeUndefined()
    expect(parseWizardState('')).toBeUndefined()
  })

  it('is undefined for a blob that is not JSON, or is the wrong kind of JSON', () => {
    expect(parseWizardState('{not json')).toBeUndefined()
    expect(parseWizardState('[]')).toBeUndefined()
    expect(parseWizardState('"a string"')).toBeUndefined()
    expect(parseWizardState('null')).toBeUndefined()
  })

  it('is undefined for a step this build does not have', () => {
    expect(
      parseWizardState(JSON.stringify({ ...initialWizardState(), step: 'payments' })),
    ).toBeUndefined()
  })

  it('is undefined when participants is missing or not a list', () => {
    const { participants: _participants, ...withoutParticipants } = initialWizardState()
    expect(parseWizardState(JSON.stringify(withoutParticipants))).toBeUndefined()
    expect(
      parseWizardState(JSON.stringify({ ...initialWizardState(), participants: {} })),
    ).toBeUndefined()
  })

  it('is undefined for a participant carrying a role that is not in the vocabulary', () => {
    const state = {
      ...initialWizardState(),
      participants: [{ ...newParticipant({ role: 'speaker', isPrimary: true }), role: 'keynote' }],
    }
    expect(parseWizardState(JSON.stringify(state))).toBeUndefined()
  })

  it('accepts every role the vocabulary declares', () => {
    for (const role of PARTICIPANT_ROLES) {
      const state = {
        ...initialWizardState(),
        participants: [newParticipant({ role, isPrimary: true })],
      }
      expect(parseWizardState(JSON.stringify(state))).toEqual(state)
    }
  })

  it('repairs a missing name rather than rejecting the whole draft', () => {
    // A blank string is what the fields render anyway, so this loses nothing, where
    // rejecting would throw away a finished set of answers over an absent key.
    const parsed = parseWizardState(
      JSON.stringify({ ...initialWizardState(), firstName: undefined, email: 42 }),
    )
    expect(parsed?.firstName).toBe('')
    expect(parsed?.email).toBe('')
  })

  it('carries the saved draft code back, so a resumed form can name the draft it is', () => {
    // CFP-07's second half. The wizard keeps its browser copy after Save & finish later now,
    // and this is what survives with it: the code the notice prints and the reason Submit
    // promotes one row instead of filing a second.
    const state = { ...initialWizardState(), email: 'ada@example.com', savedCode: 'SESS-12' }
    expect(parseWizardState(serializeWizardState(state))?.savedCode).toBe('SESS-12')
  })

  it('drops a savedCode that is not a non-empty string', () => {
    for (const savedCode of [42, '', null]) {
      const parsed = parseWizardState(JSON.stringify({ ...initialWizardState(), savedCode }))
      expect(parsed?.savedCode).toBeUndefined()
    }
  })
})
