// Where a submission's abstract body lives, and how to read it as plain text.
//
// Not obvious enough to leave at one call site, which is why this is its own module: the
// body is a form ANSWER, not a column, so finding it means resolving the form's field whose
// `registryKey` is `description` and looking the answer up by that field's id. An abstract
// added by hand has no form and stores its body under the registry key itself.
//
// Two readers with two different needs. The Abstracts table wants 240 characters for a cell
// and must not ship a 5,000-character body per row. The reviewer's scorecard wants the whole
// thing, because scoring a talk from its title is what it was doing before this existed.

import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

/** The registry key a form field carries when it IS the abstract body. */
export const MANUAL_DESCRIPTION_KEY = 'description'

/** Form id to the id of its description field, for the forms that have one. */
export function descriptionFieldIds(forms: readonly Form[]): ReadonlyMap<string, string> {
  const byForm = new Map<string, string>()
  for (const form of forms) {
    const field = form.fields.find((entry) => entry.registryKey === MANUAL_DESCRIPTION_KEY)
    if (field !== undefined) byForm.set(form.id, field.id)
  }
  return byForm
}

/**
 * The abstract body as plain text, optionally capped.
 *
 * Flattened here rather than in a component for the reason it always was: no surface may
 * render caller-supplied HTML, and this string came out of a rich-text editor a speaker
 * typed into. `limit` is a truncation for a table cell; leave it out to get the whole body.
 */
export function submissionDescription(
  submission: SubmissionWithParticipants,
  fieldIdByForm: ReadonlyMap<string, string>,
  limit?: number,
): string {
  const answers = new Map(Object.entries(submission.answers))
  const formFieldId =
    submission.formId === undefined ? undefined : fieldIdByForm.get(submission.formId)
  const raw =
    answers.get(formFieldId ?? MANUAL_DESCRIPTION_KEY) ?? answers.get(MANUAL_DESCRIPTION_KEY)
  if (typeof raw !== 'string') return ''

  const stripped = raw
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll(/\s+/g, ' ')
    .trim()

  if (limit === undefined || stripped.length <= limit) return stripped
  return `${stripped.slice(0, limit)}...`
}
