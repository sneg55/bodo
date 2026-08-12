// The wizard's localStorage copy: the format it survives a reload in, and the one question
// the restore has to answer before it says anything.
//
// Its own module rather than more of wizard-state.ts, which is at the size limit, and the
// seam is a real one: that file owns the state and the operations on it, this one owns the
// stored BLOB. The thing worth getting right about persistence is not the `setItem` call, it
// is what happens when a stored blob is a version behind or was hand-edited, and that is
// testable here and awkward to test through the DOM.
//
// This copy is the whole of CFP-07's in-this-browser half. It is written on every change and
// it is NO LONGER deleted when Save & finish later succeeds: deleting it is what made
// returning to the form URL show an empty form after a draft had been saved, leaving the
// portal and a magic link as the only way back into work the visitor had just done in this
// tab. It is still deleted on a successful SUBMIT, where there is nothing left to resume.

import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import {
  initialWizardState,
  WIZARD_STEP_KEYS,
  type WizardParticipant,
  type WizardState,
  type WizardStepKey,
} from '@/features/submissions/wizard-state'

export function serializeWizardState(state: WizardState): string {
  return JSON.stringify(state)
}

/**
 * Undefined for anything that is not a state this build wrote. A stored blob outlives
 * the code that wrote it: a form can gain a step, a role can be renamed, and a user
 * can edit localStorage by hand. Starting fresh loses at most one unsent draft, where
 * accepting a partial object renders a wizard with no step and no participants array.
 */
export function parseWizardState(raw: string | null | undefined): WizardState | undefined {
  if (raw === null || raw === undefined || raw.length === 0) return undefined
  try {
    return validateState(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * Whether a stored state is worth telling the visitor about.
 *
 * The wizard persists on every change, including the one that clears it, so a browser that
 * has been here before holds a stored state whatever happened. Announcing "we restored your
 * draft" over the empty one would be a notice about nothing, which is the same class of
 * mistake as restoring a draft and saying nothing at all.
 */
export function isEmptyWizardState(state: WizardState): boolean {
  return serializeWizardState(state) === serializeWizardState(initialWizardState())
}

function validateState(input: unknown): WizardState | undefined {
  if (!isRecord(input)) return undefined
  const step = input.step
  if (typeof step !== 'string' || !isStepKey(step)) return undefined
  if (!isRecord(input.answers)) return undefined
  if (!Array.isArray(input.participants)) return undefined

  const participants: WizardParticipant[] = []
  for (const candidate of input.participants) {
    const participant = validateParticipant(candidate)
    if (participant === undefined) return undefined
    participants.push(participant)
  }

  return {
    step,
    email: text(input.email),
    firstName: text(input.firstName),
    lastName: text(input.lastName),
    answers: input.answers,
    participants,
    // Absent for every state written before drafts were resumable, and absent again after a
    // Start over. Dropped rather than defaulted to a string, so `isEmptyWizardState` still
    // recognises a cleared state and the notice does not name a draft that is not there.
    ...(typeof input.savedCode === 'string' && input.savedCode.length > 0
      ? { savedCode: input.savedCode }
      : {}),
  }
}

function validateParticipant(input: unknown): WizardParticipant | undefined {
  if (!isRecord(input)) return undefined
  const key = input.key
  const role = input.role
  if (typeof key !== 'string' || key.length === 0) return undefined
  if (typeof role !== 'string' || !isRole(role)) return undefined
  if (!isRecord(input.answers)) return undefined
  return {
    key,
    role,
    isPrimary: input.isPrimary === true,
    firstName: text(input.firstName),
    lastName: text(input.lastName),
    email: text(input.email),
    answers: input.answers,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStepKey(value: string): value is WizardStepKey {
  return WIZARD_STEP_KEYS.some((key) => key === value)
}

function isRole(value: string): value is ParticipantRole {
  return PARTICIPANT_ROLES.some((role) => role === value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
