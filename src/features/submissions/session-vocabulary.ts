// The bridge between what a FORM offers and what the Submissions columns accept.
//
// `format`, `level` and `language` are Airtable single-selects, declared from
// `SESSION_FORMATS`, `SESSION_LEVELS` and `SESSION_LANGUAGES` in
// src/migrations/tables-core.ts. Airtable refuses a write of a choice it has not been
// given (`422 INVALID_MULTIPLE_CHOICE_OPTIONS`) and this project's token cannot create
// one, which vocabularies.ts opens with and AbstractDetailsFields.tsx hit for real. So
// the record holds a canonical VALUE from those lists and nothing else.
//
// A form's option list is bound by none of that. `OptionsEditor` fills a new option's
// value from its label ("the value follows the label"), so an organizer who types
// `Talk (30 min)` gets `value: 'Talk (30 min)'`, and `submissionColumnValues` wrote
// whatever that was straight into the column. Two consequences, and the CFP-06
// evaluation finding is the second:
//
//   - an option value outside the vocabulary rejects the WHOLE submission on write, not
//     just the one field, so the speaker loses the abstract and every participant with it;
//   - an option value inside it is a machine key, and every list, header and reviewer
//     queue printed it raw, so the organizer's Abstracts table read `talk` where the
//     speaker had answered `Talk (30 min)`.
//
// Hence both ends live here: `canonicalChoice` on the way in, `choiceLabel` on the way
// out. The stored value stays canonical and one thing renders it.

import type { Choice } from '@/constants/vocabularies'
import { SESSION_FORMATS, SESSION_LANGUAGES, SESSION_LEVELS } from '@/constants/vocabularies'
import type { FieldOption } from '@/types/forms'

/**
 * The vocabulary value an answer means, or `undefined` when it means none of them.
 *
 * Matches the stored value OR the human label, case-insensitively, because a form's
 * option can legitimately carry either: the seeded CFP form stores `talk`, while a
 * question an organizer typed by hand stores `Talk`. Both are the same choice and
 * neither should depend on which one the builder happened to produce.
 *
 * `undefined` for an unmatched answer is deliberate and it is the lesser loss. The
 * alternative is passing the value through to a 422 that rejects the entire record,
 * which is the same trade `asNumber` makes on a non-numeric CEU answer.
 */
export function canonicalChoice(
  choices: readonly Choice[],
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined
  const wanted = value.trim().toLowerCase()
  if (wanted.length === 0) return undefined
  const match = choices.find(
    (choice) => choice.value.toLowerCase() === wanted || choice.label.toLowerCase() === wanted,
  )
  return match?.value
}

/**
 * What a person reads for a stored value.
 *
 * An unknown value passes through unchanged rather than becoming a blank: a base seeded
 * before a vocabulary edit, or a session imported from Sessionize, can hold a value these
 * lists have never had, and showing it is strictly better than hiding it.
 */
export function choiceLabel(
  choices: readonly Choice[],
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined
  return choices.find((choice) => choice.value === value)?.label ?? value
}

/**
 * The record ids a LINK answer names, resolved against the question's own options.
 *
 * `Submissions.track` and `Submissions.tags` are Airtable links, so the only value either
 * column can hold is a record id on this event. Nothing between the wizard and the write
 * checked that: `submissionColumnValues` cast the raw answer to a `RecordId` and passed it
 * through, so an answer that was not an id reached Airtable as one. Two ways that happened,
 * and both are worse than they look:
 *
 *   - The question's options were never bound to the event's categories, so the value is a
 *     LABEL the organizer typed. Airtable answers 422 for the whole record, which loses the
 *     abstract and every participant on it, exactly as an out-of-vocabulary Format value
 *     used to (see the note at the top of this file).
 *   - The question is a `multiselect`, so the answer is an array, and `asText` joined it
 *     into `"recA recB"`: one string, no record, same 422.
 *
 * So the answer is resolved rather than cast. An option list is the event's own categories
 * by construction (`checks-registry.ts` refuses a Track or Tags option that is not a record
 * on this event, at save AND at publish), which makes matching against it the same thing as
 * matching against the event's tracks, and it is the only vocabulary reachable from here:
 * nothing in the submit path reads Airtable.
 *
 * Matching is by option VALUE first, then by option LABEL, case-insensitively, for the same
 * reason `canonicalChoice` accepts both: a question built by hand can legitimately carry the
 * track's NAME where the library-bound one carries its id, and "Platform & Infra" is then
 * the same choice as `recPlatformInfra`. A value that matches neither is dropped, which
 * leaves the column empty and lets the caller's precedence fall through to a routing rule
 * rather than sending a 422.
 *
 * With no options at all there is nothing to vouch for the answer, so nothing is stored.
 * That is the lesser loss: the abstract survives and the routing rule files it.
 */
export function linkedOptionValues(
  options: readonly FieldOption[] | undefined,
  values: readonly string[],
): readonly string[] {
  if (options === undefined || options.length === 0) return []
  const resolved: string[] = []
  for (const value of values) {
    const wanted = value.trim().toLowerCase()
    if (wanted.length === 0) continue
    const match = options.find(
      (option) =>
        option.value === value ||
        option.value.trim().toLowerCase() === wanted ||
        option.label.trim().toLowerCase() === wanted,
    )
    if (match === undefined) continue
    if (resolved.includes(match.value)) continue
    resolved.push(match.value)
  }
  return resolved
}

export function sessionFormatLabel(value: string | undefined): string | undefined {
  return choiceLabel(SESSION_FORMATS, value)
}

export function sessionLevelLabel(value: string | undefined): string | undefined {
  return choiceLabel(SESSION_LEVELS, value)
}

export function sessionLanguageLabel(value: string | undefined): string | undefined {
  return choiceLabel(SESSION_LANGUAGES, value)
}
