'use server'

// The organizer's three cast Server Actions. Everything they do is in ./roster-admin.ts,
// including the `admin` role check and the event-owns-this-record check; these wrappers
// exist only to pull values out of a FormData and to turn a raised AppError into a message
// the panel can render.
//
// Authorized in the ACTION's own call path and not by the route group above it, which is
// the rule in .claude/rules/bodo-conventions.md: a Server Action is reachable by POST with
// no layout ever rendering, so the detail page having drawn these controls authorizes
// nothing. `adminSubmission` in ./roster-admin.ts is where that happens, once, for all
// three.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import {
  addParticipantToSubmission,
  reassignParticipantOnSubmission,
  removeParticipantFromSubmission,
} from '@/features/submissions/roster-admin'

/** The same shape the portal's roster actions return, so the toast handling matches. */
export type RosterActionResult = { ok: true; message: string } | { ok: false; message: string }

export async function addSubmissionParticipantAction(
  formData: FormData,
): Promise<RosterActionResult> {
  return await guarded(
    async () =>
      await addParticipantToSubmission({
        eventId: required(formData, 'eventId'),
        submissionId: required(formData, 'submissionId'),
        email: required(formData, 'email'),
        firstName: optional(formData, 'firstName'),
        lastName: optional(formData, 'lastName'),
        role: role(formData),
      }),
  )
}

export async function removeSubmissionParticipantAction(
  formData: FormData,
): Promise<RosterActionResult> {
  return await guarded(
    async () =>
      await removeParticipantFromSubmission({
        eventId: required(formData, 'eventId'),
        submissionId: required(formData, 'submissionId'),
        participantId: required(formData, 'participantId'),
      }),
  )
}

export async function reassignSubmissionParticipantAction(
  formData: FormData,
): Promise<RosterActionResult> {
  return await guarded(
    async () =>
      await reassignParticipantOnSubmission({
        eventId: required(formData, 'eventId'),
        submissionId: required(formData, 'submissionId'),
        participantId: required(formData, 'participantId'),
        speakerId: required(formData, 'speakerId'),
      }),
  )
}

/**
 * The posted role, checked against the closed set before anything reads it.
 *
 * Not merely a cast, and the same reason the portal's copy gives: `role` becomes an
 * Airtable single-select value, and a value outside the declared choices answers 422 and
 * rejects the whole row.
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
 * One place that turns a raised AppError into a message the panel can render. A Server
 * Action surfaces an uncaught error as a redacted digest in production, which would tell
 * an organizer nothing about a refused edit. Anything that is not an AppError is a genuine
 * fault and is re-thrown, so it reaches the error boundary and the logs.
 */
async function guarded(
  run: () => Promise<string | { failed: string }>,
): Promise<RosterActionResult> {
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
