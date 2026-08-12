// Server-side re-validation and assembly. Nothing here touches Airtable, so all of
// it is unit tested.
//
// The client is not trusted with any of the four decisions this makes, and BUILD_SPEC
// section 5.1 requires each one on the server regardless of what the wizard did:
//
//   1. Is the form still open, and is the submitter under their cap.
//   2. Are the answers valid, for the questions that are actually VISIBLE.
//   3. Which answers are stored at all (`sanitizeAnswers` strips hidden and
//      undeclared ones before anything is written).
//   4. Which track the submission lands in, and which lifecycle it starts in.
//
// Closed and over-limit throw, because they are conditions of the endpoint rather
// than mistakes in a field, and there is no control to attach a message to. Field
// problems are returned as values, because a filled-in form has to come back with
// every mistake at once next to the control that caused it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import type { UnmappedRegistryKey } from '@/features/forms/answer-storage'
import { splitAnswers } from '@/features/forms/answer-storage'
import { sanitizeAnswers } from '@/features/forms/logic'
import type { ParticipantAnswers, Problem } from '@/features/forms/validate'
import {
  ProblemCodes,
  validateAnswers,
  validateCrossFieldLimits,
  validateParticipants,
} from '@/features/forms/validate'
import { type SubmissionColumnValues, submissionColumnValues } from '@/features/submissions/columns'
import { submissionLifecycle } from '@/features/submissions/lifecycle'
import type { ParticipantRow } from '@/features/submissions/participants'
import { speakerDraftFor, withIdentityAnswers } from '@/features/submissions/participants'
import type { SubmitParticipant, SubmitPayload } from '@/features/submissions/payload'
import { resolveTrackId } from '@/features/submissions/track-precedence'
import type { SpeakerDraft } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'
import { formPublicState } from '@/types/forms'

/** A title is required on the row, and a form with no Title field is still valid. */
const UNTITLED = 'Untitled submission'

export type PreparedParticipant = {
  draft: SpeakerDraft
  role: ParticipantRole
  isPrimary: boolean
  sortOrder: number
}

export type PreparedSubmission = {
  status: SubmissionStatus
  reviewRequired: boolean
  createsReviewRows: boolean
  title: string
  /** The `answersJson` half, already sanitized. */
  answers: Record<string, unknown>
  columns: SubmissionColumnValues
  trackId?: RecordId
  participants: readonly PreparedParticipant[]
  /** Registry keys with no column to write to. Reported, never silently dropped. */
  unmapped: readonly UnmappedRegistryKey[]
}

export type PrepareResult =
  | { ok: true; prepared: PreparedSubmission }
  | { ok: false; problems: readonly Problem[] }

export type PrepareInput = {
  form: Form
  eventId: RecordId
  payload: SubmitPayload
  now: Date
  /** Submissions this email already has against this form. Drafts included. */
  existingCount: number
  /** Resolved cap: the form's override, else the event default. */
  limit?: number
}

export function prepareSubmission(input: PrepareInput): PrepareResult {
  assertOpen(input)
  assertUnderLimit(input)

  const rows = participantRows(input)
  const problems = collectProblems(input, rows)
  if (problems.length > 0) return { ok: false, problems }

  const answers = sanitizeAnswers(input.form.fields, input.payload.answers)
  const split = splitAnswers(input.form.fields, answers)
  const columns = submissionColumnValues(split.columns)
  const lifecycle = submissionLifecycle(input.form.entityKind)

  return {
    ok: true,
    prepared: {
      ...lifecycle,
      title: columns.title ?? UNTITLED,
      answers: split.answers,
      columns,
      // The precedence rule and the failure it fixes are in `track-precedence.ts`. It
      // is shared rather than inlined because `prepareDraft` has to reach the same
      // answer: a draft that files under one track and then submits under another is
      // the same defect wearing a different hat.
      trackId: resolveTrackId({
        routing: input.form.routing,
        fields: input.form.fields,
        answers,
        columns,
      }),
      participants: rows.map((row, index) => ({
        draft: speakerDraftFor({
          participant: row,
          fields: input.form.participantFields,
          eventId: input.eventId,
        }),
        role: row.role,
        isPrimary: row.isPrimary,
        sortOrder: index + 1,
      })),
      unmapped: split.unmapped,
    },
  }
}

function assertOpen(input: PrepareInput): void {
  if (formPublicState(input.form, input.now) !== 'open') {
    throw new AppError(ErrorIds.SUB_FORM_CLOSED, 'this form is not accepting submissions', {
      publicId: input.form.publicId,
      closeDate: input.form.closeDate,
    })
  }
}

function assertUnderLimit(input: PrepareInput): void {
  const limit = input.limit
  if (limit === undefined || input.existingCount < limit) return
  throw new AppError(ErrorIds.SUB_LIMIT_REACHED, 'submission limit reached for this form', {
    publicId: input.form.publicId,
    limit,
    existingCount: input.existingCount,
  })
}

/**
 * The cast to validate and write. With participants disabled the submitter is the
 * whole cast, which is also what makes a solo speaker able to submit a form whose
 * participant step was never turned on.
 *
 * Exported and narrowed to the two fields it reads, for `draft-cast.ts`: a draft writes
 * the same cast to the same table, and two readings of "who is on this submission" is how
 * the draft and the submit end up disagreeing about it.
 */
export function participantRows(input: {
  form: Pick<Form, 'participantsEnabled' | 'participantFields' | 'roles'>
  payload: SubmitPayload
}): readonly ParticipantRow[] {
  const fields = input.form.participantFields
  if (!input.form.participantsEnabled) {
    return [
      {
        role: primaryRole(input.form),
        isPrimary: true,
        identity: submitterIdentity(input.payload),
        answers: {},
      },
    ]
  }

  return input.payload.participants.map((participant) => ({
    role: participant.role,
    isPrimary: participant.isPrimary,
    identity: {
      email: participant.email,
      firstName: participant.firstName,
      lastName: participant.lastName,
    },
    answers: withIdentityAnswers({
      fields,
      identity: {
        email: participant.email,
        firstName: participant.firstName,
        lastName: participant.lastName,
      },
      answers: participant.answers,
    }),
  }))
}

function submitterIdentity(payload: SubmitPayload): ParticipantRow['identity'] {
  return { email: payload.email, firstName: payload.firstName, lastName: payload.lastName }
}

/**
 * The role a lone submitter is filed under: the first enabled role, which the
 * default set makes `speaker`. Falling back to `speaker` rather than refusing keeps
 * a form whose roles were all disabled submittable, since that is a builder mistake
 * the speaker cannot fix.
 *
 * Exported for `draft-write.ts`, which files the same person on the same submission and
 * must not disagree. NOT `firstEnabledRole` from wizard-state.ts, despite the name: that
 * one reads `roles.at(0)` and is only ever right because `toPublicForm` filters the
 * disabled ones out before the client sees them. Handed a full `Form`, it returns a role
 * the organizer switched off.
 */
export function primaryRole(form: Pick<Form, 'roles'>): ParticipantRole {
  return form.roles.find((rule) => rule.enabled)?.role ?? 'speaker'
}

function collectProblems(input: PrepareInput, rows: readonly ParticipantRow[]): readonly Problem[] {
  const problems: Problem[] = [...validateAnswers(input.form.fields, input.payload.answers)]

  if (input.form.participantsEnabled) {
    problems.push(...validateParticipants(input.form.roles, rows))
    problems.push(...participantProblems(input, rows))
  }

  problems.push(
    ...validateCrossFieldLimits(
      input.form.crossFieldLimits,
      input.payload.answers,
      participantAnswers(input, rows),
      [...input.form.fields, ...input.form.participantFields],
    ),
  )

  return problems
}

/**
 * Per-participant answers for a `perParticipant` combined limit. Empty when
 * participants are off, so the rule falls back to the submission's own answers,
 * which is the solo case the wizard hits first.
 */
function participantAnswers(
  input: PrepareInput,
  rows: readonly ParticipantRow[],
): readonly ParticipantAnswers[] {
  if (!input.form.participantsEnabled) return []
  return rows.map((row, index) => ({
    participantId: participantKey(input.payload.participants, index),
    answers: row.answers,
  }))
}

function participantKey(participants: readonly SubmitParticipant[], index: number): string {
  return participants.at(index)?.key ?? String(index)
}

/**
 * Each participant's own question set, plus the one rule the form cannot express: a
 * Speakers row is keyed on email, so a participant without one cannot be created at
 * all. Checked here even when the form has no Email question, because the wizard
 * collects it as a typed field either way.
 */
function participantProblems(
  input: PrepareInput,
  rows: readonly ParticipantRow[],
): readonly Problem[] {
  const problems: Problem[] = []

  rows.forEach((row, index) => {
    const participantId = participantKey(input.payload.participants, index)
    if (row.identity.email.trim().length === 0) {
      problems.push({
        participantId,
        code: ProblemCodes.REQUIRED,
        message: 'Email is required for every participant.',
      })
    }
    for (const problem of validateAnswers(input.form.participantFields, row.answers)) {
      problems.push({ ...problem, participantId })
    }
  })

  return problems
}
