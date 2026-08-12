// Where a question's options are allowed to come from, when the form does not own them.
//
// Most questions own their option list: the organizer types a label, the value follows, and
// the answer lands in `answersJson` as whatever string they wrote. Five registry keys are
// different, because their answers reach a CONSTRAINED Airtable column, and in both shapes
// the builder was letting an organizer author something the column can never hold:
//
//   - `track` and `tags` are LINK columns. The option value is a record id, so it must name a
//     record on THIS event. `checks-registry` refused a foreign one, correctly, but the only
//     options control in the editor was the free-text one: typing "Frontend" produced
//     `value: 'Frontend'`, which is not a record id on any event, so the save was refused with
//     a message about data the organizer had no way to see or supply. That is the CFP-01
//     evaluation finding, and it made a new form on an event with no categories unsaveable.
//   - `format`, `level` and `language` are SINGLE SELECTS declared from the fixed vocabularies
//     in src/constants/vocabularies.ts, and this project's token cannot create a choice. An
//     option value outside the vocabulary used to reject the WHOLE submission with
//     `422 INVALID_MULTIPLE_CHOICE_OPTIONS`, taking the abstract and every participant with
//     it; `canonicalChoice` now drops the unmatched answer instead, which is a smaller loss
//     but still a loss. The fix belongs here, where the option is authored.
//
// So both ends read the same source: the editor offers exactly these choices, and the checks
// refuse anything else. A key that is not one of the five has no source and keeps the
// free-text editor.

import type { Choice } from '@/constants/vocabularies'
import { SESSION_FORMATS, SESSION_LANGUAGES, SESSION_LEVELS } from '@/constants/vocabularies'
import { canonicalChoice } from '@/features/submissions/session-vocabulary'
import type { FieldOption, FormField } from '@/types/forms'

/** The event's own categories, as the editor already loads them (`loadFormEditor`). */
export type EventCategories = {
  trackOptions: readonly FieldOption[]
  tagOptions: readonly FieldOption[]
}

export type OptionSource = {
  key: string
  /** `event` means the record ids of this event's categories; `vocabulary` a fixed list. */
  origin: 'event' | 'vocabulary'
  /** Every option the organizer may offer. Empty only when the event has no categories yet. */
  choices: readonly FieldOption[]
  /** What one choice is called, so a message reads in the organizer's words. */
  noun: 'category' | 'choice'
  /** The Library tab that creates more of them. Only the event-backed keys have one. */
  settingsTab?: 'tracks' | 'tags'
}

const VOCABULARIES: ReadonlyMap<string, readonly Choice[]> = new Map([
  ['format', SESSION_FORMATS],
  ['level', SESSION_LEVELS],
  ['language', SESSION_LANGUAGES],
])

/** The fixed vocabulary a registry key writes into, or `undefined` for a free-text list. */
export function vocabularyFor(key: string | undefined): readonly Choice[] | undefined {
  if (key === undefined) return undefined
  return VOCABULARIES.get(key)
}

/** True when the EVENT, not the form, decides what this question may offer. */
export function usesEventCategories(field: FormField): boolean {
  return field.registryKey === 'track' || field.registryKey === 'tags'
}

/** What the question editor may offer for this field, or `undefined` for free text. */
export function optionSource(field: FormField, event: EventCategories): OptionSource | undefined {
  const key = field.registryKey
  if (key === undefined) return undefined
  if (key === 'track') {
    return {
      key,
      origin: 'event',
      choices: event.trackOptions,
      noun: 'category',
      settingsTab: 'tracks',
    }
  }
  if (key === 'tags') {
    return {
      key,
      origin: 'event',
      choices: event.tagOptions,
      noun: 'category',
      settingsTab: 'tags',
    }
  }
  const vocabulary = vocabularyFor(key)
  if (vocabulary === undefined) return undefined
  return {
    key,
    origin: 'vocabulary',
    choices: vocabulary.map((choice) => ({ value: choice.value, label: choice.label })),
    noun: 'choice',
  }
}

/**
 * Can this option value actually be stored?
 *
 * An event category is matched EXACTLY, because the value is a record id and a near miss is
 * another event's record or nothing at all. A vocabulary value goes through
 * `canonicalChoice`, which also accepts the human label, because a form built by hand
 * legitimately stores `Talk` where the seeded one stores `talk` and both mean the same
 * choice.
 */
export function isStorableOption(source: OptionSource, value: string): boolean {
  if (source.origin === 'event') return source.choices.some((choice) => choice.value === value)
  return canonicalChoice(source.choices, value) !== undefined
}

/**
 * The option currently offering this choice, or `undefined` when the question does not.
 *
 * Not an equality test on the value, because of the vocabulary case: a form built by hand
 * stores `Talk` where the seeded one stores `talk`, both are the same choice, and a picker
 * that compared exactly would show a question's own option as unticked and then add a second
 * copy of it.
 */
export function optionForChoice(
  source: OptionSource,
  options: readonly FieldOption[],
  choice: FieldOption,
): FieldOption | undefined {
  if (source.origin === 'event') return options.find((option) => option.value === choice.value)
  return options.find((option) => canonicalChoice(source.choices, option.value) === choice.value)
}

/** The options on this field that the column behind it cannot hold. */
export function unstorableOptions(field: FormField, source: OptionSource): readonly FieldOption[] {
  return (field.options ?? []).filter((option) => !isStorableOption(source, option.value))
}

/** Values a vocabulary-backed question offers that the column would not store. */
export function unstorableVocabularyValues(
  field: FormField,
  vocabulary: readonly Choice[],
): readonly string[] {
  return (field.options ?? [])
    .filter((option) => canonicalChoice(vocabulary, option.value) === undefined)
    .map((option) => option.value)
}
