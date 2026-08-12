// Turning the typed half of a split answer set into the properties `SubmissionDraft`
// declares.
//
// `splitAnswers` decides WHICH answers belong in first-class Airtable columns and
// hands them back as `ReadonlyMap<SubmissionColumn, unknown>`, deliberately untyped:
// it knows where a value goes, not what shape it is. This narrows each one, because
// `ceuCredits` is a number column and `tagIds` is a link array, and sending a string
// where Airtable wants a number is accepted-looking right up to the 422.
//
// `format`, `level` and `language` are narrowed hardest of all, because they are
// single-selects whose choices Airtable will not let this project add to: they are
// resolved against the vocabulary the column was created with rather than passed
// through. See `session-vocabulary.ts` for the failure that costs.
//
// `trackId` and `tagIds` are the LINK columns, and they get the same treatment one step
// earlier: `splitAnswers` resolves those answers against the question's own options, which
// are the event's own categories, before they arrive here. So this narrows an already
// resolved list rather than casting a string to a `RecordId` and hoping, which is what it
// did when a Track answer of `Platform & Infra` reached a link column (see `asId`).
//
// A value that cannot be narrowed is dropped rather than coerced. It has already
// passed `validateAnswers`, so the only way to get here with a wrong-typed value is
// a payload the wizard did not build, and writing `NaN` into a credits column is
// worse than leaving it empty.

import type { Choice } from '@/constants/vocabularies'
import { SESSION_FORMATS, SESSION_LANGUAGES, SESSION_LEVELS } from '@/constants/vocabularies'
import type { SubmissionColumn } from '@/features/forms/answer-storage'
import { answerValues } from '@/features/forms/logic'
import { canonicalChoice } from '@/features/submissions/session-vocabulary'
import type { RecordId } from '@/types/domain'

export type SubmissionColumnValues = {
  title?: string
  format?: string
  level?: string
  language?: string
  ceuCredits?: number
  trackId?: RecordId
  tagIds?: readonly RecordId[]
}

/** Assignable while the object is being built up. */
type Mutable = { -readonly [K in keyof SubmissionColumnValues]: SubmissionColumnValues[K] }

function asText(value: unknown): string | undefined {
  const joined = answerValues(value).join(' ')
  return joined.length === 0 ? undefined : joined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  // A blank answer is not a zero. `Number('')` is 0 and finite, so without this an
  // untouched or cleared CEU credits question wrote 0 credits into the column and the
  // record then claimed a fact the speaker never stated.
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * A single-select column's value, resolved against the vocabulary the column was created
 * with. See `session-vocabulary.ts`: the form's option value is not bound to that list, so
 * a Format question the organizer typed as `Talk` was written verbatim into a column whose
 * only declared choices are `talk`, `workshop`, `panel`, `keynote` and `lightning`, and
 * Airtable answered 422 for the whole record.
 */
function asChoice(choices: readonly Choice[], value: unknown): string | undefined {
  return canonicalChoice(choices, asText(value))
}

function asIds(value: unknown): readonly RecordId[] | undefined {
  const ids = answerValues(value)
  return ids.length === 0 ? undefined : ids
}

/**
 * The single record id a LINK column takes.
 *
 * NOT `asText`, and that difference is the CFP-15 evaluation finding. `asText` joins every
 * value in the answer with a space, so a Track question the organizer made a `multiselect`
 * produced `"recA recB"`: one string, naming no record, and Airtable answers 422 for the
 * whole submission. It also cast whatever it was handed to a `RecordId` with nothing
 * checking that the value named a track at all, so a question whose options were never
 * bound to the event's categories wrote the organizer's LABEL into a link column.
 *
 * Both are fixed upstream now: `splitAnswers` resolves a link answer against the question's
 * own options before it ever reaches here (`linkedOptionValues` in `session-vocabulary.ts`
 * says why that list is the event's real track vocabulary), so what arrives is a list of
 * option values and nothing else. This takes the first, because the column holds one link,
 * and `undefined` when the answer resolved to nothing, which is what lets `resolveTrackId`
 * fall through to a routing rule instead of sending a 422.
 */
function asId(value: unknown): RecordId | undefined {
  return answerValues(value).at(0)
}

/** A switch rather than a dynamic index, and exhaustive so a new column fails here. */
function assign(target: Mutable, column: SubmissionColumn, value: unknown): void {
  switch (column) {
    case 'title':
      target.title = asText(value)
      break
    case 'format':
      target.format = asChoice(SESSION_FORMATS, value)
      break
    case 'level':
      target.level = asChoice(SESSION_LEVELS, value)
      break
    case 'language':
      target.language = asChoice(SESSION_LANGUAGES, value)
      break
    case 'ceuCredits':
      target.ceuCredits = asNumber(value)
      break
    case 'trackId':
      target.trackId = asId(value)
      break
    case 'tagIds':
      target.tagIds = asIds(value)
      break
  }
}

export function submissionColumnValues(
  columns: ReadonlyMap<SubmissionColumn, unknown>,
): SubmissionColumnValues {
  const values: Mutable = {}
  for (const [column, value] of columns) {
    assign(values, column, value)
  }
  return values
}
