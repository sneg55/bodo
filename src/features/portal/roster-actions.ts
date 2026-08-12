'use server'

// The two roster Server Actions. Everything they do is in ./roster-edit.ts, including the
// ownership check and the server-side re-derivation of the edit policy; these wrappers
// exist only to pull values out of a FormData and to turn a raised AppError into a message
// the form can render.
//
// A separate module from ./actions.ts rather than two more functions in it: that file is
// near its size budget, and these two are one feature with its own rules module and its own
// mutations module behind them.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import { addParticipant, removeParticipant } from '@/features/portal/roster-edit'

/** The same shape ./actions.ts returns, so the client components can share a renderer. */
export type ActionResult = { ok: true; message: string } | { ok: false; message: string }

export async function addParticipantAction(formData: FormData): Promise<ActionResult> {
  return await guarded(
    async () =>
      await addParticipant({
        code: required(formData, 'code'),
        email: required(formData, 'email'),
        firstName: optional(formData, 'firstName'),
        lastName: optional(formData, 'lastName'),
        role: role(formData),
      }),
  )
}

export async function removeParticipantAction(formData: FormData): Promise<ActionResult> {
  return await guarded(
    async () =>
      await removeParticipant({
        code: required(formData, 'code'),
        participantId: required(formData, 'participantId'),
      }),
  )
}

/**
 * The posted role, checked against the closed set before anything reads it.
 *
 * Not merely a cast: `role` becomes an Airtable single-select value, and a value outside
 * the declared choices answers 422 and rejects the whole row. Whether the role is one this
 * FORM offers is a different question, and `additionProblems` answers it against the
 * form's own rules.
 */
function role(formData: FormData): ParticipantRole {
  const posted = required(formData, 'role')
  const match = PARTICIPANT_ROLES.find((candidate) => candidate === posted)
  if (match === undefined) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'that is not a participant role', { posted })
  }
  return match
}

function required(formData: FormData, name: string): string {
  const value = formData.get(name)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `${name} is required`, { name })
  }
  return value.trim()
}

function optional(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * One place that turns a raised AppError into a message the form can render, matching
 * `guarded()` in ./actions.ts. Server Actions surface an uncaught error as a generic "an
 * error occurred" in production, which would tell a speaker nothing about a refused edit.
 */
async function guarded(run: () => Promise<string | { failed: string }>): Promise<ActionResult> {
  try {
    const outcome = await run()
    if (typeof outcome === 'string') return { ok: true, message: outcome }
    return { ok: false, message: outcome.failed }
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return { ok: false, message: error.message }
    }
    throw error
  }
}
