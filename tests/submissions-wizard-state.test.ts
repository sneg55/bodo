// The public wizard's client store: the shape of it and every operation the steps perform.
//
// The stored FORMAT it survives a reload in lives in ./wizard-draft.ts and is tested in
// tests/wizard-draft.test.ts, which moved there with it when this file reached the size
// limit.

import { describe, expect, it } from 'vitest'

import { PARTICIPANT_ROLES } from '@/constants/status'
import type { PublicForm } from '@/features/submissions/public-form'
import { parseWizardState, serializeWizardState } from '@/features/submissions/wizard-draft'
import {
  firstEnabledRole,
  initialWizardState,
  newParticipant,
  removeParticipant,
  seedPrimaryParticipant,
  setAnswer,
  setParticipantAnswer,
  setPrimary,
  setSubmitterIdentity,
  updateParticipant,
  WIZARD_STEP_LABELS,
  wizardSteps,
  wizardStorageKey,
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

describe('wizardSteps', () => {
  it('is the five parity steps, labelled verbatim', () => {
    expect(wizardSteps(FORM).map((step) => WIZARD_STEP_LABELS.get(step))).toEqual([
      'Welcome!',
      'Account',
      'Submission',
      'Participant',
      'Review',
    ])
  })

  it('drops the Participant step when the organizer turned participants off', () => {
    expect(wizardSteps({ ...FORM, participantsEnabled: false })).toEqual([
      'welcome',
      'account',
      'submission',
      'review',
    ])
  })

  it('keys storage per form, so two forms on one origin do not share a draft', () => {
    expect(wizardStorageKey('pub1')).not.toBe(wizardStorageKey('pub2'))
  })
})

describe('seedPrimaryParticipant', () => {
  it('creates the solo speaker from the Account step, so one person can submit alone', () => {
    const seeded = seedPrimaryParticipant(filled(), FORM)
    expect(seeded.participants).toHaveLength(1)
    expect(seeded.participants[0].isPrimary).toBe(true)
    expect(seeded.participants[0].role).toBe('speaker')
    expect(seeded.participants[0].email).toBe('ada@example.com')
  })

  it('fills blanks on the primary row but never overwrites an edited value', () => {
    const state = {
      ...filled(),
      participants: [newParticipant({ role: 'speaker', isPrimary: true, firstName: 'Adaobi' })],
    }
    const seeded = seedPrimaryParticipant(state, FORM)
    expect(seeded.participants[0].firstName).toBe('Adaobi')
    expect(seeded.participants[0].email).toBe('ada@example.com')
  })

  it('does nothing when participants are off', () => {
    const state = filled()
    expect(seedPrimaryParticipant(state, { ...FORM, participantsEnabled: false })).toBe(state)
  })

  it('reads the first enabled role, falling back to speaker for a form with none', () => {
    expect(firstEnabledRole(FORM)).toBe('speaker')
    expect(firstEnabledRole({ roles: [] })).toBe('speaker')
  })
})

describe('participant list edits', () => {
  const state = {
    ...filled(),
    participants: [
      newParticipant({ role: 'speaker', isPrimary: true, email: 'ada@example.com' }),
      newParticipant({ role: 'co_speaker', isPrimary: false, email: 'bruno@example.com' }),
    ],
  }
  const [first, second] = state.participants

  it('moves primary rather than adding a second one', () => {
    const moved = setPrimary(state, second.key)
    expect(moved.participants.map((participant) => participant.isPrimary)).toEqual([false, true])
  })

  it('promotes the next row when the primary is removed', () => {
    // A cast with nobody primary has no address for the confirmation email and no owner
    // for the portal record, so removal cannot leave one.
    const removed = removeParticipant(state, first.key)
    expect(removed.participants).toHaveLength(1)
    expect(removed.participants[0].isPrimary).toBe(true)
  })

  it('leaves primary alone when a non-primary is removed', () => {
    const removed = removeParticipant(state, second.key)
    expect(removed.participants).toEqual([first])
  })

  it('patches one row and leaves the others untouched', () => {
    const patched = updateParticipant(state, second.key, { firstName: 'Bruno' })
    expect(patched.participants[1].firstName).toBe('Bruno')
    expect(patched.participants[0]).toEqual(first)
  })

  it('stores a participant answer under its field id', () => {
    const answered = setParticipantAnswer(state, first.key, 'p_bio', 'Hello')
    expect(answered.participants[0].answers).toEqual({ p_bio: 'Hello' })
  })

  it('ignores an answer for a participant that is not in the list', () => {
    expect(setParticipantAnswer(state, 'gone', 'p_bio', 'Hello')).toBe(state)
  })
})

describe('setAnswer', () => {
  it('replaces an answer rather than merging into it', () => {
    const once = setAnswer(initialWizardState(), 'f_title', 'First')
    const twice = setAnswer(once, 'f_title', 'Second')
    expect(twice.answers).toEqual({ f_title: 'Second' })
  })

  it('keeps a cleared answer as an empty value rather than dropping the key', () => {
    // Clearing a field and never answering it are different facts, and only the server's
    // sanitize step decides what is stored.
    const cleared = setAnswer(setAnswer(initialWizardState(), 'f_title', 'x'), 'f_title', '')
    expect(Object.keys(cleared.answers)).toEqual(['f_title'])
  })
})

// The Account step and the Participant step disagreeing about who is submitting.
//
// An evaluation run switched the account identity after the cast had been seeded, and the
// Review step then read "Submitted by <person A>" over a participant list containing
// <person B>. Both are shown to the organizer and the row is filed under one of them, so two
// answers to "whose talk is this" is worse than either answer on its own.
describe('setSubmitterIdentity', () => {
  const seeded = () =>
    seedPrimaryParticipant(
      { ...initialWizardState(), email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor' },
      FORM,
    )

  it('carries an account edit into the primary participant it seeded', () => {
    const next = setSubmitterIdentity(seeded(), { email: 'grace@example.com' })

    expect(next.email).toBe('grace@example.com')
    expect(next.participants[0]?.email).toBe('grace@example.com')
  })

  it('carries the name too, so the recap cannot name two people', () => {
    const next = setSubmitterIdentity(seeded(), { firstName: 'Grace', lastName: 'Hopper' })

    expect(next.participants[0]?.firstName).toBe('Grace')
    expect(next.participants[0]?.lastName).toBe('Hopper')
  })

  it('leaves a participant field the visitor edited by hand alone', () => {
    // The primary row is editable on purpose, so clobbering an edit would be the same defect
    // pointing the other way. What follows the Account step is a field that is still blank,
    // or one that still holds the value the Account step put there.
    const state = seeded()
    const key = state.participants[0]?.key ?? ''
    const edited = updateParticipant(state, key, { email: 'typed-by-hand@example.com' })

    const next = setSubmitterIdentity(edited, { email: 'grace@example.com' })

    expect(next.email).toBe('grace@example.com')
    expect(next.participants[0]?.email).toBe('typed-by-hand@example.com')
  })

  it('fills a blank participant field rather than leaving it empty', () => {
    const state = {
      ...initialWizardState(),
      participants: [newParticipant({ role: 'speaker', isPrimary: true })],
    }

    expect(setSubmitterIdentity(state, { email: 'ada@example.com' }).participants[0]?.email).toBe(
      'ada@example.com',
    )
  })

  it('touches nobody when the first row is not the primary', () => {
    // A cast whose first row is a co-speaker was not seeded from the Account step, so it is
    // not one this may rewrite.
    const state = {
      ...initialWizardState(),
      participants: [
        newParticipant({ role: 'co_speaker', isPrimary: false, email: 'marcus@example.com' }),
      ],
    }

    expect(setSubmitterIdentity(state, { email: 'ada@example.com' }).participants[0]?.email).toBe(
      'marcus@example.com',
    )
  })
})
