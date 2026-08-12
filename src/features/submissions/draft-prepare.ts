// What a save-and-finish-later turns into, before anything is written.
//
// The sibling of `prepareSubmission`, and the difference between them is exactly one
// thing: a draft is ALLOWED to be incomplete. Everything else is deliberately identical,
// because a draft becomes the submitted record in place (the portal's Submit flips the
// same row to `pending`), so a draft prepared by a looser set of rules would be a
// submission that was never checked.
//
// Concretely, of the four decisions `prepareSubmission` makes on the server:
//
//   1. Is the form still open. SAME. A closed form must not accept a draft either.
//   2. Are the answers valid. RELAXED, and only for the missing ones. A draft with no
//      Description is the whole point; a draft with a 40,000-character Description is
//      not, and would fail the eventual submit with the speaker's work already stored.
//      So shape and length problems still refuse the save and `REQUIRED` ones do not.
//   3. Which answers are stored. SAME, `sanitizeAnswers` and `splitAnswers` unchanged.
//   4. Which track it lands in. SAME, through the shared `resolveTrackId`.
//
// The cap is the caller's, as it is for a submit, because it needs a read.

import type { UnmappedRegistryKey } from '@/features/forms/answer-storage'
import { splitAnswers } from '@/features/forms/answer-storage'
import { sanitizeAnswers } from '@/features/forms/logic'
import type { Problem } from '@/features/forms/validate'
import { ProblemCodes, validateAnswers } from '@/features/forms/validate'
import type { SubmissionColumnValues } from '@/features/submissions/columns'
import { submissionColumnValues } from '@/features/submissions/columns'
import { submissionLifecycle } from '@/features/submissions/lifecycle'
import type { SubmitPayload } from '@/features/submissions/payload'
import { resolveTrackId } from '@/features/submissions/track-precedence'
import type { RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'

/** Matches `prepareSubmission`: a row needs a title and a form need not ask for one. */
const UNTITLED = 'Untitled submission'

/** Loose, and deliberately the same shape `accountProblems` gates the Account step with. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * The one identity rule a draft still has: it must know whose draft it is.
 *
 * The address is the ONLY thing that makes a draft survive a device, because it is what
 * the speaker signs in with to find it again. So it is required here where every other
 * question is not, and the message says why rather than repeating the Account step's.
 */
export function identityProblems(rawEmail: string): readonly Problem[] {
  const email = rawEmail.trim()
  if (email.length === 0) {
    return [
      { code: ProblemCodes.REQUIRED, message: 'Your Email Address is required to save a draft.' },
    ]
  }
  if (!EMAIL_SHAPE.test(email.toLowerCase())) {
    return [
      {
        code: ProblemCodes.EMAIL_INVALID,
        message: 'Your Email Address is not a valid email address.',
      },
    ]
  }
  return []
}

export type PreparedDraft = {
  title: string
  answers: Record<string, unknown>
  columns: SubmissionColumnValues
  trackId?: RecordId
  /**
   * What the row will be worth once it IS submitted, stamped now for the same reason
   * `prepareSubmission` stamps it: section 5.1b says it is decided at creation and never
   * re-derived from the form, and the portal's Submit only moves the status.
   */
  reviewRequired: boolean
  unmapped: readonly UnmappedRegistryKey[]
}

export type PrepareDraftResult =
  | { ok: true; prepared: PreparedDraft }
  | { ok: false; problems: readonly Problem[] }

/**
 * True when there is something worth putting in a record.
 *
 * A draft of nothing is a Speakers row and a Submissions row created for a visitor who
 * typed an address and left, which is the cheapest thing a public endpoint should refuse
 * to do. The bar is deliberately low, not absent: the acceptance criterion is "with as
 * little as a title", so one answered question or a title clears it.
 */
export function hasDraftContent(input: { title?: string; answers: Record<string, unknown> }) {
  if ((input.title ?? '').trim().length > 0) return true
  return Object.keys(input.answers).length > 0
}

export function prepareDraft(input: { form: Form; payload: SubmitPayload }): PrepareDraftResult {
  const { form, payload } = input

  // Missing answers are what a draft IS. Everything else `validateAnswers` reports is a
  // value that would be stored wrong or would block the submit later, so it refuses now,
  // while the speaker still has the wizard open and the control to fix it in front of them.
  const problems = validateAnswers(form.fields, payload.answers).filter(
    (problem) => problem.code !== ProblemCodes.REQUIRED,
  )
  if (problems.length > 0) return { ok: false, problems }

  const answers = sanitizeAnswers(form.fields, payload.answers)
  const split = splitAnswers(form.fields, answers)
  const columns = submissionColumnValues(split.columns)

  return {
    ok: true,
    prepared: {
      title: columns.title ?? UNTITLED,
      answers: split.answers,
      columns,
      trackId: resolveTrackId({
        routing: form.routing,
        fields: form.fields,
        answers,
        columns,
      }),
      reviewRequired: submissionLifecycle(form.entityKind).reviewRequired,
      unmapped: split.unmapped,
    },
  }
}
