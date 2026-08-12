// Server-side preparation for the speaker's body edit. Nothing here touches Airtable.
//
// Four decisions, none of which the client is trusted with, and each one is the same
// decision the public submit re-makes in `@/features/submissions/prepare`:
//
//   1. May this submission's body be edited AT ALL, from its current status and the
//      form's current state. Recomputed here rather than posted, because BUILD_SPEC 4 is
//      explicit that a layout or a disabled input is not a security boundary: the page
//      that rendered the form is not what authorizes the write.
//   2. Are the answers valid, for the questions that are actually VISIBLE.
//   3. Which answers are stored at all. `sanitizeAnswers` strips the hidden and the
//      undeclared ones, so a stale answer to a question the speaker no longer sees
//      cannot be filed as one they gave.
//   4. Which half of storage each surviving answer belongs in (`splitAnswers`).
//
// A frozen body throws, because it is a condition of the record rather than a mistake in
// a field and there is no control to attach a message to. Field problems come back as
// values, because a filled-in form has to return with every mistake at once.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { SubmissionStatus } from '@/constants/status'
import type { UnmappedRegistryKey } from '@/features/forms/answer-storage'
import { splitAnswers } from '@/features/forms/answer-storage'
import type { FormAnswers } from '@/features/forms/logic'
import { sanitizeAnswers } from '@/features/forms/logic'
import type { Problem } from '@/features/forms/validate'
import { validateAnswers, validateCrossFieldLimits } from '@/features/forms/validate'
import { type EditPermission, submissionEditPermission } from '@/features/portal/edit-mode'
import { submissionColumnValues } from '@/features/submissions/columns'
import type { SubmissionEdit } from '@/services/airtable/to-fields'
import type { SubmissionWithParticipants } from '@/types/domain'
import { type Form, formPublicState } from '@/types/forms'

/**
 * The edit policy for one submission, from the record and the form rather than from
 * anything the caller supplies.
 *
 * A submission with no form is frozen, and that is the right answer rather than a gap: a
 * manual submission was never asked through a form, so there is no question set to render
 * and no field definitions to validate an answer against.
 */
export function bodyEditPermission(input: {
  status: SubmissionStatus
  form?: Form
  now: Date
}): EditPermission {
  const formAcceptsUpdates =
    input.form !== undefined && formPublicState(input.form, input.now) === 'open'
  return submissionEditPermission({ status: input.status, formAcceptsUpdates })
}

export type PreparedBodyEdit = {
  permission: EditPermission
  /** Ready for `updateSubmission`: the title, the typed columns, and the whole blob. */
  edit: SubmissionEdit
  /** Registry keys with no column to write to. Reported, never silently dropped. */
  unmapped: readonly UnmappedRegistryKey[]
}

export type BodyEditResult =
  | { ok: true; prepared: PreparedBodyEdit }
  | { ok: false; problems: readonly Problem[] }

export type BodyEditInput = {
  submission: SubmissionWithParticipants
  /** The form it came through, absent for a manual submission. */
  form?: Form
  now: Date
  /** Raw answers as posted, keyed by `FormField.id`. Stripped here, not by the caller. */
  answers: FormAnswers
}

export function prepareBodyEdit(input: BodyEditInput): BodyEditResult {
  const { submission, form, now } = input
  const permission = bodyEditPermission({ status: submission.status, form, now })

  if (!permission.bodyEditable || form === undefined) {
    throw new AppError(ErrorIds.SUB_BODY_LOCKED, permission.detail, {
      submissionId: submission.id,
      status: submission.status,
      mode: permission.mode,
    })
  }

  const problems = [
    ...validateAnswers(form.fields, input.answers),
    ...validateCrossFieldLimits(form.crossFieldLimits, input.answers, [], form.fields),
  ]
  if (problems.length > 0) return { ok: false, problems }

  const answers = sanitizeAnswers(form.fields, input.answers)
  const split = splitAnswers(form.fields, answers)
  const columns = submissionColumnValues(split.columns)

  return {
    ok: true,
    prepared: {
      permission,
      edit: {
        ...columns,
        // The column is written on every edit, so a form that asks no Title question has
        // to carry the stored title through or the save would blank it.
        title: columns.title ?? submission.title,
        answers: split.answers,
      },
      unmapped: split.unmapped,
    },
  }
}

/**
 * The posted answer set.
 *
 * It arrives as one JSON value rather than as named form fields, because the controls are
 * the same `FieldControl` the wizard uses: a multiselect answer is an array and a checkbox
 * answer is a boolean, and form encoding flattens both to strings that then fail the
 * server's shape checks. A Server Action is an open POST target, so this is the only shape
 * check between a caller and `sanitizeAnswers`.
 */
export function parsePostedAnswers(raw: string): FormAnswers {
  const parsed: unknown = safeParse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'the posted answers could not be read', {})
  }
  return { ...(parsed as Record<string, unknown>) }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'the posted answers could not be read', {})
  }
}
