// Add, remove, reorder, patch: the question-list operations, as pure functions on an
// array of field definitions.
//
// Pure so the editor's undo-free state is a value rather than a mutation, and so the
// cases that are expensive to reproduce through the UI are unit tested instead: deleting
// the question another question's `showIf` points at, deleting the question a routing
// rule fires on, and trying to delete a locked system field.
//
// Ids are passed in rather than generated here. `nanoid()` at the call site keeps this
// module deterministic, which is the difference between a test that pins the behaviour
// and a test that pins a snapshot of a random string.

import type { RegistryField } from '@/constants/fields'
import { OPTION_TYPES } from '@/features/forms/builder/draft'
import { DEFAULT_MAX_LEN, type FieldType, type FormField, type RoutingConfig } from '@/types/forms'

/**
 * The field types a question rule may fire on.
 *
 * Stated by the reference and not inferred: conditional logic ("Question rules") is
 * "Available for `Checkbox`, `Dropdown`, and `Number` fields"
 * (docs/parity/external-references.md, off `/sessions/submission-forms`). `select` is the
 * stored name of the type the product labels `Dropdown`.
 *
 * Radio and Multi-Select are therefore NOT offered, even though `visibleFields` evaluates a
 * rule on either perfectly well. A rule already stored against one keeps working and stays
 * editable; the builder just stops authoring new ones, and says so.
 */
export const RULE_FIELD_TYPES: readonly FieldType[] = ['checkbox', 'select', 'number']

/** Read through a Map, since indexing a Record with a variable is a lint error. */
const CAP_BY_TYPE: ReadonlyMap<FieldType, number> = new Map(
  Object.entries(DEFAULT_MAX_LEN).map(([type, cap]) => [type as FieldType, cap]),
)

/** A question the organizer invented. No registry key, so its answer is a blob entry. */
export function fieldFromType(type: FieldType, id: string): FormField {
  return {
    id,
    type,
    label: '',
    required: false,
    maxLen: CAP_BY_TYPE.get(type),
    options: OPTION_TYPES.includes(type) ? [] : undefined,
  }
}

/**
 * A question taken from the field registry.
 *
 * `registryKey` is set here and nowhere else, which is the whole point of routing
 * "+ Add Field" through the library rather than through a bare type picker: it is what
 * puts the answer in a typed Airtable column instead of `answersJson`.
 */
export function fieldFromRegistry(registry: RegistryField, id: string): FormField {
  return {
    id,
    type: registry.type,
    label: registry.label,
    help: registry.help,
    // A locked field is rendered with its Required toggle on and disabled.
    required: registry.locked === true,
    locked: registry.locked,
    maxLen: registry.maxLen ?? CAP_BY_TYPE.get(registry.type),
    options: OPTION_TYPES.includes(registry.type) ? [] : undefined,
    registryKey: registry.key,
  }
}

export function addField(fields: readonly FormField[], field: FormField): readonly FormField[] {
  return [...fields, field]
}

export function updateField(
  fields: readonly FormField[],
  id: string,
  patch: Partial<FormField>,
): readonly FormField[] {
  return fields.map((field) => (field.id === id ? { ...field, ...patch, id: field.id } : field))
}

/**
 * Removal, refused for a locked field.
 *
 * Locked means the system owns the question: Title is the abstract form's, and a form
 * with no Title field produces submissions titled "Untitled submission" (see
 * `prepareSubmission`). The refusal is silent because the row's delete item is already
 * disabled, so reaching this is a keyboard or a forged call, not an organizer's choice.
 */
export function removeField(fields: readonly FormField[], id: string): readonly FormField[] {
  const target = fields.find((field) => field.id === id)
  if (target === undefined || target.locked === true) return fields
  return fields
    .filter((field) => field.id !== id)
    .map((field) => (field.showIf?.fieldId === id ? { ...field, showIf: undefined } : field))
}

/**
 * Locked system fields the incoming list has dropped.
 *
 * The reference states the rule for both halves of a submission form: on Session information
 * "The `Page Heading` is required and cannot be deleted", and on Speaker information
 * "`First Name`, `Last Name`, and `Email` are mandatory and cannot be deleted"
 * (docs/parity/external-references.md). Our own screenshot names the session-side field
 * `Title`, which is the label this build keeps, and the reference settles the BEHAVIOUR.
 *
 * `removeField` above refuses the same delete in the editor. This is the server's copy of
 * that refusal, and it is not redundant: `saveFormAction` takes the whole field list from the
 * client, so a row that the UI never offers a Delete item for is still absent from a hand
 * built POST that simply omits it.
 */
export function missingLockedFields(
  stored: readonly FormField[],
  next: readonly FormField[],
): readonly FormField[] {
  const ids = new Set(next.map((field) => field.id))
  return stored.filter((field) => field.locked === true && !ids.has(field.id))
}

/**
 * The incoming list with every lock the STORED form had put back on.
 *
 * Deleting the row is the loud way to unlock a system field. `locked` and `required` both
 * travel in the draft, so clearing them is the quiet way to the same place: a form whose
 * Title is optional produces submissions titled "Untitled submission" (`prepareSubmission`),
 * and a speaker form with an optional Email produces a participant nothing can be sent to.
 *
 * `showIf` is cleared for the same reason and it is the THIRD way to the same place, which
 * restoring the other two does not close: a locked field left `required` but conditioned on a
 * question whose answer does not match is not visible, and `visibleFields` is what validation
 * runs over, so the required check never fires and the submission is titled
 * "Untitled submission" anyway. A system field is unconditional by definition, and the builder
 * offers no rule on one, so there is nothing legitimate to preserve here. Found by Codex review.
 */
export function withLocksRestored(
  stored: readonly FormField[],
  next: readonly FormField[],
): readonly FormField[] {
  const locked = new Set(stored.filter((field) => field.locked === true).map((field) => field.id))
  return next.map((field) =>
    locked.has(field.id) ? { ...field, locked: true, required: true, showIf: undefined } : field,
  )
}

/** Routing rules that pointed at a deleted question, dropped with it. */
export function pruneRouting(routing: RoutingConfig, removedId: string): RoutingConfig {
  return {
    rules: routing.rules.filter((rule) => rule.when.fieldId !== removedId),
    defaultTrackId: routing.defaultTrackId,
  }
}

/** One step up or down, clamped. Used by the row menu, so reorder works by keyboard. */
export function moveField(
  fields: readonly FormField[],
  id: string,
  delta: number,
): readonly FormField[] {
  const from = fields.findIndex((field) => field.id === id)
  if (from < 0) return fields
  const to = from + delta
  if (to < 0 || to >= fields.length) return fields
  return withMove(fields, from, to)
}

/** The drag-and-drop form of the same move: drop `activeId` where `overId` sits. */
export function reorderFields(
  fields: readonly FormField[],
  activeId: string,
  overId: string,
): readonly FormField[] {
  const from = fields.findIndex((field) => field.id === activeId)
  const to = fields.findIndex((field) => field.id === overId)
  if (from < 0 || to < 0 || from === to) return fields
  return withMove(fields, from, to)
}

function withMove(fields: readonly FormField[], from: number, to: number): readonly FormField[] {
  const next = [...fields]
  const moved = next.at(from)
  if (moved === undefined) return fields
  next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * The questions a condition on `id` may point at: the ones before it that are not
 * themselves conditional.
 *
 * Both halves are the "one dependency level" contract in BUILD_SPEC 5.1. Before it,
 * because a question cannot depend on an answer the speaker has not been asked for yet.
 * Not conditional itself, because a chain is a second level, and `visibleFields`
 * resolves one but the builder must not author one.
 */
export function availableControllers(
  fields: readonly FormField[],
  id: string,
): readonly FormField[] {
  const index = fields.findIndex((field) => field.id === id)
  const preceding = index < 0 ? fields : fields.slice(0, index)
  return preceding.filter((field) => field.showIf === undefined)
}

/**
 * The questions a NEW rule may be authored against: the ones `availableControllers` allows by
 * position, narrowed to the three types the reference says question rules are available for.
 *
 * `keepId` is the controller a rule already points at. It survives the narrowing so that
 * opening a form built before this restriction shows its rule rather than an empty picker and
 * a value that silently stops matching.
 */
export function ruleControllers(
  fields: readonly FormField[],
  id: string,
  keepId?: string,
): readonly FormField[] {
  return availableControllers(fields, id).filter(
    (field) => RULE_FIELD_TYPES.includes(field.type) || field.id === keepId,
  )
}

/**
 * Which control the rule's VALUE needs, given the question it fires on.
 *
 * `none` is the `is answered` case and the only one with nothing to compare against. The
 * other three exist because a `Dropdown` rule matches an option while a `Checkbox` and a
 * `Number` have no option list at all: offering the option picker for those was what made
 * two of the three reference-eligible types unusable in practice.
 */
export function ruleValueMode(
  controller: FormField | undefined,
): 'options' | 'boolean' | 'text' | 'none' {
  if (controller === undefined) return 'none'
  if ((controller.options ?? []).length > 0) return 'options'
  if (controller.type === 'checkbox') return 'boolean'
  if (controller.type === 'number') return 'text'
  return 'none'
}

/**
 * The questions a combined character limit may span: the ones whose answers are text with a
 * character cap of their own.
 *
 * Defined off `DEFAULT_MAX_LEN` rather than a hand-written list, so the eligible set is
 * exactly "the types this product counts characters for" (Text, Wysiwyg, Biography, URL,
 * Video) and a new capped type joins it without a second edit. A choice question is
 * excluded on purpose: its answer's length is an option value the speaker did not type, so
 * spending a shared budget on it would be arithmetic nobody can see.
 */
export function limitableFields(fields: readonly FormField[]): readonly FormField[] {
  return fields.filter((field) => CAP_BY_TYPE.has(field.type))
}

/** The questions a routing rule may fire on: any question with a fixed option list. */
export function routableFields(fields: readonly FormField[]): readonly FormField[] {
  return fields.filter((field) => (field.options ?? []).length > 0)
}
