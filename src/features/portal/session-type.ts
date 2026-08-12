// The session-type subtitle on a submission card.
//
// Refs 17-18 show `Featured Keynote` and `Keynote` under the `SESS-<n> - <title>`
// line, so the subtitle is a human label and not the stored value. The stored value
// is `Submissions.format`, whose vocabulary is organizer-defined: the registry marks
// `format` a select but the option list lives on the form field
// (src/services/airtable/fixtures/form.ts stores `talk` and shows `Talk (30 min)`).
//
// So the label is resolved through the form's own options when the form is to hand,
// and only prettified from the raw value when it is not. Prettifying always would
// print `Talk` where the organizer wrote `Talk (30 min)`, and familiarity is scored.

import type { Submission } from '@/types/domain'
import type { FieldOption, Form } from '@/types/forms'

/** The Format field's options on a form, or none when the form does not ask. */
export function formatOptions(form: Form | undefined): readonly FieldOption[] {
  if (form === undefined) return []
  return form.fields.find((field) => field.registryKey === 'format')?.options ?? []
}

export function sessionTypeLabel(
  submission: Pick<Submission, 'format'>,
  options: readonly FieldOption[] = [],
): string | undefined {
  const value = submission.format
  if (value === undefined || value.trim() === '') return undefined

  const matched = options.find((option) => option.value === value)
  if (matched !== undefined) return matched.label

  return prettify(value)
}

/**
 * `featured_keynote` to `Featured Keynote`. Only reached for a value with no option
 * behind it, which means a manual submission or a form field that has since been
 * edited: showing the raw snake_case token would look like a bug.
 */
function prettify(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
