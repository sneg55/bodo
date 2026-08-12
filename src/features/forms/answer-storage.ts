// Where each validated answer is stored. BUILD_SPEC section 3 splits a submission
// in two: a registry field with `column: true` lives in a first-class Airtable
// column, so the Abstracts table can sort and filter on it, and everything else
// lives in `answersJson`, which cannot be sorted or filtered.
//
// `FormField.registryKey` is the only input to that decision. Label, type and lock
// state are all forgeable by an organizer building a form: a local select called
// "Format" with the same two options is structurally identical to the registry's
// Format field, and inferring from any of them writes that local answer into the
// column the real Format field owns, where nothing will ever notice.
//
// A key this module cannot place is reported rather than dropped. Losing an answer
// silently is the one outcome worse than storing it in the wrong half.
//
// It does one thing beyond placing: the two LINK columns get their answer RESOLVED against
// the question's own options on the way past (`columnValue`). That is not a shape decision
// escaping from columns.ts, it is the one decision only this module can make, because this
// is the last point at which an answer still knows which question it came from.

import { registryField } from '@/constants/fields'
import { answerIndex, answerValues, type FormAnswers } from '@/features/forms/logic'
import { linkedOptionValues } from '@/features/submissions/session-vocabulary'
import type { Submission } from '@/types/domain'
import type { FormField } from '@/types/forms'

/**
 * The `Submission` properties an answer is allowed to write. `Extract` rather than a
 * bare union so a rename in `Submission` fails the build here instead of writing to
 * a property that no longer exists.
 */
export type SubmissionColumn = Extract<
  keyof Submission,
  'title' | 'format' | 'level' | 'language' | 'ceuCredits' | 'trackId' | 'tagIds'
>

/**
 * Registry key to the property it writes. Explicit because the two do not always
 * match: the registry calls them `track` and `tags` while the record holds
 * `trackId` and `tagIds`, and a convention that is right five times out of seven is
 * worse than no convention.
 *
 * Only the columns a form can collect are here. `code`, `status`, `source`,
 * `submittedAt`, `notifiedAt`, `scheduleStatus` and the scheduling columns are set
 * by the app, never by an answer, so a form field claiming one of them is a bug
 * this module reports rather than honours.
 */
export const COLUMN_BY_REGISTRY_KEY: ReadonlyMap<string, SubmissionColumn> = new Map([
  ['title', 'title'],
  ['format', 'format'],
  ['level', 'level'],
  ['language', 'language'],
  ['ceuCredits', 'ceuCredits'],
  ['track', 'trackId'],
  ['tags', 'tagIds'],
])

/** A registry key with no column to write to. Reported so it cannot pass unnoticed. */
export type UnmappedRegistryKey = {
  fieldId: string
  registryKey: string
}

export type AnswerSplit = {
  /**
   * Keyed by `Submission` property. A Map rather than a partial record, so building
   * it needs no dynamic index and a caller cannot confuse "absent" with "cleared".
   */
  columns: ReadonlyMap<SubmissionColumn, unknown>
  /** Everything bound for `answersJson`, still keyed by `FormField.id`. */
  answers: Record<string, unknown>
  unmapped: readonly UnmappedRegistryKey[]
}

/**
 * True when a registry key ought to have had a column and did not: either the
 * registry declares it one (so `answersJson` absorbing it would quietly cost the
 * table a sortable column), or the registry has never heard of the key at all,
 * which means a stale or hand-edited `fieldsJson`.
 */
function isGap(key: string): boolean {
  const registered = registryField(key)
  return registered === undefined || registered.column
}

/** The two columns that are Airtable LINKS, so only a record id on this event fits. */
const LINK_COLUMNS: readonly SubmissionColumn[] = ['trackId', 'tagIds']

/**
 * The value a column receives, which for the two link columns is not the raw answer.
 *
 * This is the last place that still knows which QUESTION an answer came from, and for a
 * link column that is the only thing that can vouch for the answer: the option list on a
 * Track or Tags question IS the event's own categories (`checks-registry.ts` refuses any
 * other, at save and at publish), so resolving against it is resolving against the event's
 * tracks. `submissionColumnValues` sees only the value and cast it to a `RecordId`, which
 * is how a label an organizer typed, or a multiselect's array joined into one string,
 * reached Airtable as a record id and answered 422 for the whole submission.
 *
 * Everything else is passed through untouched: `columns.ts` narrows it, and deciding a
 * value's shape is that module's job, not this one's.
 */
function columnValue(column: SubmissionColumn, field: FormField, answer: unknown): unknown {
  if (!LINK_COLUMNS.includes(column)) return answer
  return linkedOptionValues(field.options, answerValues(answer))
}

/**
 * Splits an answer set for storage. Pass the sanitized, validated answers: this
 * decides where a value goes, not whether it should be there at all.
 *
 * Fields with no answer are left out entirely, so an untouched optional question
 * does not overwrite a column with nothing.
 */
export function splitAnswers(fields: readonly FormField[], answers: FormAnswers): AnswerSplit {
  const index = answerIndex(answers)
  const columns = new Map<SubmissionColumn, unknown>()
  const rest: [string, unknown][] = []
  const unmapped: UnmappedRegistryKey[] = []

  for (const field of fields) {
    if (!index.has(field.id)) continue
    const answer = index.get(field.id)
    const key = field.registryKey
    if (key === undefined) {
      rest.push([field.id, answer])
      continue
    }
    const column = COLUMN_BY_REGISTRY_KEY.get(key)
    if (column !== undefined) {
      columns.set(column, columnValue(column, field, answer))
      continue
    }
    // Either a deliberate answersJson registry field (`description`) or a gap. Both
    // keep the answer; only the gap is worth telling the caller about.
    rest.push([field.id, answer])
    if (isGap(key)) unmapped.push({ fieldId: field.id, registryKey: key })
  }

  return { columns, answers: Object.fromEntries(rest), unmapped }
}
