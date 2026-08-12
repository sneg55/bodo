// The base as the Meta API reports it, and the one kind of change a MATCHED field can
// still need.
//
// Split out of diff.ts when that file crossed the size limit, and the seam is real rather
// than arbitrary: everything here is about a column that ALREADY EXISTS, while diff.ts is
// about what has to be created. It also breaks a dependency cycle -- the choice planner
// needs the shape of an existing field, and diff.ts needs the planner.
//
// The rule this file exists to fix, stated once: `planSchema` matched a field by name and
// type and counted it as done. A single-select can match on both and still be missing half
// its vocabulary. `CmsEmbeds.format` shipped holding one choice, `styled_html`; four more
// were added to the declaration; `airtable:schema:plan` reported "0 fields" while every
// save of a new format returned 422 INVALID_MULTIPLE_CHOICE_OPTIONS. A field this script
// created was one it could no longer keep correct, and the gap was invisible because the
// plan's own output said there was nothing to do.

import type { FieldSpec } from '@/migrations/schema-types'

/** A choice as the base holds it. The id is what lets a PATCH keep it rather than drop it. */
export type ExistingChoice = { readonly id: string; readonly name: string }

/** A field as the Meta API reports it. Only the parts a diff reads. */
export type ExistingField = {
  /** Absent only from a base that did not report one; a PATCH cannot be built without it. */
  readonly id?: string
  readonly name: string
  readonly type: string
  readonly options?: { readonly choices?: readonly ExistingChoice[] }
}

export type ExistingTable = {
  readonly id: string
  readonly name: string
  readonly fields: readonly ExistingField[]
}

/**
 * A select that exists but is missing declared choices. Pass three.
 *
 * ADDITIVE ONLY. `keep` is every choice already in the base, ids intact, whether declared
 * or not; `add` is the declared names that are missing. Nothing is renamed and nothing is
 * removed, for the same reason a type disagreement is reported rather than applied: a
 * choice is referenced by records, and dropping one is not recoverable from here. Keeping
 * undeclared choices is the same rule the rest of the diff follows -- it asks "is what I
 * declared present", never "is anything present that I did not declare".
 */
export type ChoiceAdd = {
  readonly tableName: string
  readonly fieldName: string
  readonly fieldId: string
  readonly keep: readonly ExistingChoice[]
  readonly add: readonly string[]
}

/** The types whose `options.choices` this script reconciles. */
const CHOICE_TYPES = new Set(['singleSelect', 'multipleSelects'])

/**
 * The declared choice names, or undefined when this is not a choice field.
 *
 * Reads the declaration's own shape: `select()` in schema-types.ts builds
 * `options.choices` as `{ name }[]`, so there is no second place a vocabulary could be
 * written down and drift from.
 */
function declaredChoices(field: FieldSpec): readonly string[] | undefined {
  if (!CHOICE_TYPES.has(field.type)) return undefined
  const choices = field.options?.choices
  if (!Array.isArray(choices)) return undefined

  return choices.flatMap((choice) => {
    const name = (choice as { name?: unknown } | null)?.name
    return typeof name === 'string' ? [name] : []
  })
}

/**
 * What pass three has to do for one matched select, or nothing.
 *
 * Returns nothing when the field carries no id, because a PATCH needs one and a base that
 * did not report one is a base this cannot safely widen. Silence beats a guess, and the
 * next run reads the schema again.
 */
export function planChoices(
  tableName: string,
  spec: FieldSpec,
  found: ExistingField,
): ChoiceAdd | undefined {
  const declared = declaredChoices(spec)
  if (declared === undefined || found.id === undefined) return undefined

  const keep = found.options?.choices ?? []
  const present = new Set(keep.map((choice) => choice.name))
  const add = declared.filter((name) => !present.has(name))
  if (add.length === 0) return undefined

  return { tableName, fieldName: spec.name, fieldId: found.id, keep, add }
}

/**
 * The whole choice list a PATCH must send, existing ids intact.
 *
 * A PATCH REPLACES `options.choices`, so sending only the additions asks Airtable to
 * delete every existing choice, which it refuses when records use them. A surviving
 * choice sent by name alone reads as a new one, which is how a field ends up with two
 * options spelled identically.
 */
export function choicePatchFor(add: ChoiceAdd): readonly { id?: string; name: string }[] {
  return [
    ...add.keep.map((choice) => ({ id: choice.id, name: choice.name })),
    ...add.add.map((name) => ({ name })),
  ]
}
