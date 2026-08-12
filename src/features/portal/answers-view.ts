// The submitted answers, read-only, in the form's own field order.
//
// BUILD_SPEC 5.2: "the submitted answers rendered read-only in the form's own field
// order (typed columns first, then `answersJson` extras)". Two halves have to be
// stitched back together to do that, because storage split them: a registry field
// with `column: true` went to a first-class Airtable column and everything else went
// to `answersJson` (see @/features/forms/answer-storage). The form is the only thing
// that remembers what order the speaker was asked in.
//
// Rich text is rendered as text, not as HTML. The stored value is speaker-authored
// markup and this codebase has no HTML sanitizer (`sanitizeAnswers` in
// @/features/forms/logic strips undeclared ANSWERS, not tags), so putting it through
// `dangerouslySetInnerHTML` would make one speaker's abstract a script that runs in
// the organizer's session. Block tags become newlines so paragraphs survive.

import { registryField } from '@/constants/fields'
import { storedAnswer } from '@/features/portal/submission-columns'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'
import type { Form, FormField } from '@/types/forms'
import { htmlToText } from '@/utils/html-text'

export type AnswerRow = {
  key: string
  label: string
  /** Multi-valued answers render as chips; everything else is one block of text. */
  values: readonly string[]
}

export type AnswerLookups = {
  /** Track and tag answers are record ids. Resolves one to its name. */
  nameOf?: (id: RecordId) => string | undefined
}

export function submittedAnswers(input: {
  submission: SubmissionWithParticipants
  form?: Form
  lookups?: AnswerLookups
}): readonly AnswerRow[] {
  const { submission, form, lookups } = input
  const extras = new Map(Object.entries(submission.answers))
  const rows: AnswerRow[] = []

  for (const field of form?.fields ?? []) {
    const row = rowForField(field, submission, extras, lookups)
    if (row !== undefined) rows.push(row)
    extras.delete(field.id)
  }

  // Anything left in answersJson: an answer to a question the form no longer asks,
  // or a manual submission that never had a form. Kept rather than dropped, because
  // the speaker did write it and a silently missing answer is unfalsifiable.
  for (const [key, value] of extras) {
    const values = formatValue(value, lookups)
    if (values.length > 0) rows.push({ key, label: extraLabel(key), values })
  }

  return rows
}

function rowForField(
  field: FormField,
  submission: SubmissionWithParticipants,
  extras: ReadonlyMap<string, unknown>,
  lookups: AnswerLookups | undefined,
): AnswerRow | undefined {
  const values = formatValue(storedAnswer(field, submission, extras), lookups, field)
  if (values.length === 0) return undefined
  return { key: field.id, label: field.label, values }
}

/** A choice field's label for one stored value, or `undefined` when it offers no such option. */
function optionLabel(
  field: Pick<FormField, 'options'> | undefined,
  value: string,
): string | undefined {
  return field?.options?.find((option) => option.value === value)?.label
}

/** The registry's label for a leftover key, or the key itself. */
function extraLabel(key: string): string {
  return registryField(key)?.label ?? key
}

/**
 * One answer to zero or more display strings. Zero means "not answered", which is
 * how an untouched optional question stays off the page entirely rather than
 * rendering as an empty row.
 */
function formatValue(
  value: unknown,
  lookups: AnswerLookups | undefined,
  field?: Pick<FormField, 'options'>,
): readonly string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) {
    return value.flatMap((entry) => formatValue(entry, lookups, field))
  }
  if (typeof value === 'boolean') return [value ? 'Yes' : 'No']
  if (typeof value === 'number') return [String(value)]
  if (typeof value !== 'string') return []

  // The field's own option label first, then a record-name lookup, then the raw text. Without
  // the first step this read-only view showed a speaker `workshop` where they had chosen
  // "Workshop (90 min)": the lookup only resolves Track and Tag record IDS, so every other
  // choice field fell through to its stored value. The same defect as the CFP Review step, in a
  // second place, found by Codex review. `answerLabels` cannot be reused directly here because
  // this walks one value at a time through the recursion above.
  const label = optionLabel(field, value)
  const resolved = label ?? lookups?.nameOf?.(value) ?? htmlToText(value)
  return resolved.trim() === '' ? [] : [resolved]
}

/**
 * Re-exported, not defined here any more.
 *
 * It moved to `@/utils/html-text` so the PUBLIC CFP wizard's Review step can flatten an
 * abstract without pulling the field registry and the submission column map into its client
 * chunk. Kept as an export because several callers here and in the review surfaces import it
 * from this module, and one shared implementation is the whole point.
 */
export { htmlToText } from '@/utils/html-text'
