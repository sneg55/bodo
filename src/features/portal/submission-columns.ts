// Reading a submission's typed columns back out, keyed by the field that wrote them.
//
// Storage splits an answer set in two (@/features/forms/answer-storage): a registry field
// with `column: true` went to a first-class Airtable column and everything else went to
// `answersJson`. Both the read-only view and the edit form have to put the two halves back
// together in the form's own field order, so the reader lives here rather than in either
// of them: one place deciding where an answer came from cannot disagree with itself.

import { COLUMN_BY_REGISTRY_KEY, type SubmissionColumn } from '@/features/forms/answer-storage'
import type { FormAnswers } from '@/features/forms/logic'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { FormField } from '@/types/forms'

/**
 * Getters keyed by the property an answer writes to. A Map of accessors rather than a
 * dynamic index, because `security/detect-object-injection` treats a computed read on a
 * plain object as a sink and that warning fails the build.
 */
const COLUMN_READERS: ReadonlyMap<
  SubmissionColumn,
  (submission: SubmissionWithParticipants) => unknown
> = new Map<SubmissionColumn, (submission: SubmissionWithParticipants) => unknown>([
  ['title', (submission) => submission.title],
  ['format', (submission) => submission.format],
  ['level', (submission) => submission.level],
  ['language', (submission) => submission.language],
  ['ceuCredits', (submission) => submission.ceuCredits],
  ['trackId', (submission) => submission.trackId],
  ['tagIds', (submission) => submission.tagIds],
])

/** The column a field's answer was stored in, or undefined for an `answersJson` field. */
export function columnForField(field: FormField): SubmissionColumn | undefined {
  const key = field.registryKey
  return key === undefined ? undefined : COLUMN_BY_REGISTRY_KEY.get(key)
}

/** What the record holds for one column. */
export function readSubmissionColumn(
  submission: SubmissionWithParticipants,
  column: SubmissionColumn,
): unknown {
  return COLUMN_READERS.get(column)?.(submission)
}

/**
 * The stored answer to one of the form's questions, whichever half it lives in.
 */
export function storedAnswer(
  field: FormField,
  submission: SubmissionWithParticipants,
  extras: ReadonlyMap<string, unknown>,
): unknown {
  const column = columnForField(field)
  if (column === undefined) return extras.get(field.id)
  return readSubmissionColumn(submission, column)
}

/**
 * The answer set to seed an edit form with, keyed by `FormField.id`.
 *
 * Unanswered questions are left out rather than included as empty, so the control renders
 * blank and `splitAnswers` still treats the column as untouched if nobody types in it.
 *
 * Numbers come back as strings because that is the shape a form post carries and the one
 * `shape-checks` accepts for a `number` field; handing `1.5` to a text control would
 * render an empty box and then save the emptiness.
 */
export function answersForForm(
  fields: readonly FormField[],
  submission: SubmissionWithParticipants,
): FormAnswers {
  const extras = new Map(Object.entries(submission.answers))
  const seeded: [string, unknown][] = []

  for (const field of fields) {
    const answer = storedAnswer(field, submission, extras)
    if (answer === undefined || answer === null) continue
    // `tagIds` is an empty array rather than absent when nothing is tagged, so an empty
    // one is "unanswered" here too: seeding it would post a key nobody filled in.
    if (Array.isArray(answer) && answer.length === 0) continue
    seeded.push([field.id, typeof answer === 'number' ? String(answer) : answer])
  }

  return Object.fromEntries(seeded)
}
