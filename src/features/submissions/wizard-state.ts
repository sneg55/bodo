// The public wizard's client state.
//
// Pure on purpose, and unit tested in tests/submissions-wizard-state.test.ts. The stored
// FORMAT it survives a reload in moved to ./wizard-draft.ts when this file reached the size
// limit; everything here is the state itself and the operations the steps perform on it.
//
// The state deliberately holds no track, no status, and no record ids. Those are the
// server's to decide (see prepare.ts), and a client store that carried them would be
// a client that could choose them.

import { nanoid } from 'nanoid'

import type { ParticipantRole } from '@/constants/status'
import type { PublicForm } from '@/features/submissions/public-form'

export const WIZARD_STEP_KEYS = [
  'welcome',
  'account',
  'submission',
  'participant',
  'review',
] as const

export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number]

/** Rail labels, verbatim from docs/parity/public-cfp.md (ref 16). */
export const WIZARD_STEP_LABELS: ReadonlyMap<WizardStepKey, string> = new Map([
  ['welcome', 'Welcome!'],
  ['account', 'Account'],
  ['submission', 'Submission'],
  ['participant', 'Participant'],
  ['review', 'Review'],
])

export type WizardAnswers = Record<string, unknown>

export type WizardParticipant = {
  /** Stable across re-renders so a problem can point at a row with no record id. */
  key: string
  role: ParticipantRole
  isPrimary: boolean
  firstName: string
  lastName: string
  email: string
  answers: WizardAnswers
}

export type WizardState = {
  step: WizardStepKey
  email: string
  firstName: string
  lastName: string
  answers: WizardAnswers
  participants: readonly WizardParticipant[]
  /**
   * `SESS-<n>`, once this work has been saved as a real draft row by Save & finish later.
   *
   * Persisted with the rest of the state, which is the whole of CFP-07's second half: the
   * wizard used to DELETE its localStorage copy on a successful save, so coming back to the
   * form URL found an empty form and the only way back in was a magic link into the portal.
   * It is kept now, and this is what lets the restored form say which draft it is.
   *
   * Never sent to the server and never trusted by it. The submit finds the row to promote by
   * asking Airtable which draft this address has against this form (`submitterContext`), so
   * a hand-edited code here can address nothing.
   */
  savedCode?: string
}

/** localStorage is shared across every form on the origin, so the key names one. */
export function wizardStorageKey(publicId: string): string {
  return `bodo:submit:${publicId}`
}

/**
 * The rail for one form. The Participant step is absent when the organizer turned
 * participants off, which is what makes the numbering right rather than showing a
 * step that is skipped on arrival.
 */
export function wizardSteps(
  form: Pick<PublicForm, 'participantsEnabled'>,
): readonly WizardStepKey[] {
  if (form.participantsEnabled) return WIZARD_STEP_KEYS
  return WIZARD_STEP_KEYS.filter((key) => key !== 'participant')
}

export function firstEnabledRole(form: Pick<PublicForm, 'roles'>): ParticipantRole {
  return form.roles.at(0)?.role ?? 'speaker'
}

/**
 * The cast starts empty rather than with a seeded primary, because the Account step
 * has not run yet and a row with no email would render as an error on arrival.
 * `seedPrimaryParticipant` fills it in on the way into the Participant step.
 */
export function initialWizardState(): WizardState {
  return { step: 'welcome', email: '', firstName: '', lastName: '', answers: {}, participants: [] }
}

export function newParticipant(input: {
  role: ParticipantRole
  isPrimary: boolean
  firstName?: string
  lastName?: string
  email?: string
}): WizardParticipant {
  return {
    key: nanoid(10),
    role: input.role,
    isPrimary: input.isPrimary,
    firstName: input.firstName ?? '',
    lastName: input.lastName ?? '',
    email: input.email ?? '',
    answers: {},
  }
}

/**
 * The primary participant is the submitter, so the Account step's answers seed the
 * first row rather than being retyped.
 *
 * A solo speaker MUST be able to submit (BUILD_SPEC section 5.1 is emphatic about
 * this: a default that blocks one fails at the exact moment a stranger is trying to
 * give you a talk), so arriving at the Participant step with an empty cast creates
 * that one row instead of presenting an empty list and a minimum of one.
 */
export function seedPrimaryParticipant(
  state: WizardState,
  form: Pick<PublicForm, 'roles' | 'participantsEnabled'>,
): WizardState {
  if (!form.participantsEnabled) return state
  const first = state.participants.at(0)
  if (first === undefined) {
    return {
      ...state,
      participants: [
        newParticipant({
          role: firstEnabledRole(form),
          isPrimary: true,
          firstName: state.firstName,
          lastName: state.lastName,
          email: state.email,
        }),
      ],
    }
  }
  if (!first.isPrimary) return state
  // Identity stays in step while it is still blank, so a speaker who filled Account
  // and came straight here does not see empty fields. An edited value is left alone.
  return {
    ...state,
    participants: [
      {
        ...first,
        firstName: blankOr(first.firstName, state.firstName),
        lastName: blankOr(first.lastName, state.lastName),
        email: blankOr(first.email, state.email),
      },
      ...state.participants.slice(1),
    ],
  }
}

function blankOr(current: string, fallback: string): string {
  return current.trim().length === 0 ? fallback : current
}

/**
 * An edit on the Account step, carried through to the primary participant it seeded.
 *
 * `seedPrimaryParticipant` above only fills BLANKS, and only on the way into the Participant
 * step, which left the two able to disagree permanently: an evaluation run changed the
 * account identity after the cast had been seeded, and the Review step then read "Submitted
 * by <person A>" over a participant list containing <person B>. Both are shown to the
 * organizer, and the submission is filed under one of them, so a form that displays two
 * answers to "whose talk is this" is worse than either answer.
 *
 * FOLLOWS rather than overwrites. A field the visitor has typed something else into is left
 * exactly as it is: the primary participant row is editable on purpose, and clobbering an
 * edit would be the same defect pointing the other way. What follows is a field that is
 * still blank, or one that still holds the value the Account step put there.
 */
export function setSubmitterIdentity(
  state: WizardState,
  patch: Partial<Pick<WizardState, 'email' | 'firstName' | 'lastName'>>,
): WizardState {
  const next: WizardState = { ...state, ...patch }
  const first = state.participants.at(0)
  if (first === undefined || !first.isPrimary) return next

  return {
    ...next,
    participants: [
      {
        ...first,
        email: seeded(first.email, state.email, next.email),
        firstName: seeded(first.firstName, state.firstName, next.firstName),
        lastName: seeded(first.lastName, state.lastName, next.lastName),
      },
      ...state.participants.slice(1),
    ],
  }
}

function seeded(current: string, wasAccount: string, isAccount: string): string {
  if (current.trim().length === 0) return isAccount
  return current.trim() === wasAccount.trim() ? isAccount : current
}

/** Exactly one primary, enforced as the list changes rather than checked at the end. */
export function setPrimary(state: WizardState, key: string): WizardState {
  return {
    ...state,
    participants: state.participants.map((participant) => ({
      ...participant,
      isPrimary: participant.key === key,
    })),
  }
}

export function updateParticipant(
  state: WizardState,
  key: string,
  patch: Partial<Omit<WizardParticipant, 'key'>>,
): WizardState {
  return {
    ...state,
    participants: state.participants.map((participant) =>
      participant.key === key ? { ...participant, ...patch } : participant,
    ),
  }
}

/**
 * Removing the primary promotes the next row, because a cast with nobody primary has
 * no address for the confirmation email and no owner for the portal record.
 */
export function removeParticipant(state: WizardState, key: string): WizardState {
  const kept = state.participants.filter((participant) => participant.key !== key)
  if (kept.length === 0 || kept.some((participant) => participant.isPrimary)) {
    return { ...state, participants: kept }
  }
  return {
    ...state,
    participants: kept.map((participant, index) => ({ ...participant, isPrimary: index === 0 })),
  }
}

/**
 * Answers are replaced wholesale rather than merged, so clearing a field clears the
 * stored answer. `sanitizeAnswers` strips whatever is hidden at submit time, so a
 * stale conditional answer left here is never stored.
 */
export function setAnswer(state: WizardState, fieldId: string, value: unknown): WizardState {
  const answers = new Map(Object.entries(state.answers))
  answers.set(fieldId, value)
  return { ...state, answers: Object.fromEntries(answers) }
}

export function setParticipantAnswer(
  state: WizardState,
  key: string,
  fieldId: string,
  value: unknown,
): WizardState {
  const target = state.participants.find((participant) => participant.key === key)
  if (target === undefined) return state
  const answers = new Map(Object.entries(target.answers))
  answers.set(fieldId, value)
  return updateParticipant(state, key, { answers: Object.fromEntries(answers) })
}
