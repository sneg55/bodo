// Which control a field type gets, and when a field gets no control at all.
//
// Split out of `FieldControl.tsx` at the file-size limit, and it is the seam that falls out
// of it: that file is the rendering, this is the by-type tables it looks things up in plus
// the one rule that decides a question is not worth rendering. Being pure also makes that
// rule unit testable, which the component around it is not.

import { answerLength } from '@/features/forms/logic'
import { DEFAULT_MAX_LEN, type FieldType, type FormField } from '@/types/forms'

/** Read through a Map, since indexing a Record with a variable is a lint error. */
export const DEFAULT_MAX_LEN_BY_TYPE: ReadonlyMap<FieldType, number> = new Map(
  Object.entries(DEFAULT_MAX_LEN).map(([type, cap]) => [type as FieldType, cap]),
)

/** Which host input type carries a given field type, for the single-line cases. */
export const INPUT_TYPES: ReadonlyMap<FieldType, string> = new Map([
  ['email', 'email'],
  ['phone', 'tel'],
  ['url', 'url'],
  ['video', 'url'],
  ['file', 'url'],
  ['speaker_headshot', 'url'],
  ['number', 'number'],
  ['datetime', 'datetime-local'],
])

export const LONG_TEXT_TYPES: readonly FieldType[] = ['speaker_bio']

/** The types the builder caps, and so the types that carry a counter. */
export const COUNTED_TYPES: readonly FieldType[] = ['wysiwyg', ...LONG_TEXT_TYPES]

/**
 * The types that render from an option list. The same list as `builder/draft`'s
 * `OPTION_TYPES`, and deliberately not imported from it: this module ships in the PUBLIC
 * wizard's bundle, and that one pulls the whole builder (agenda time maths, team members,
 * headings) in behind it for three strings.
 */
export const CHOICE_TYPES: readonly FieldType[] = ['select', 'multiselect', 'radio']

/**
 * A choice question that offers nothing and holds nothing: a control the speaker can neither
 * answer nor read, so it is not rendered at all.
 *
 * The case is ordinary rather than exotic. "Create Form" seeds Track and Tags from the event's
 * own categories, and an event that has none yet gets both questions with an empty option
 * list. That form is now saveable and publishable on purpose (see `checkCategoryOptions`), so
 * without this the first thing a stranger meets on a new CFP is two dropdowns that open onto
 * nothing. This project deletes a dead control rather than showing it inert.
 *
 * Two exclusions, and both are about never hiding something that still matters:
 *
 *   - REQUIRED is still rendered. The builder refuses to save required-with-no-options, so
 *     this can only be a form stored before that check, and `visibleFields` is what
 *     validation runs over: hiding a field the wizard still demands an answer for would be an
 *     unsubmittable form with nothing on screen to explain it.
 *   - An ANSWERED question is still rendered. Options can be removed after a speaker has
 *     answered, and their own answer is not something to make invisible.
 */
export function isDeadChoice(field: FormField, value: unknown): boolean {
  if (!CHOICE_TYPES.includes(field.type)) return false
  if (field.required) return false
  if ((field.options ?? []).length > 0) return false
  return answerLength(value, field.type) === 0
}
