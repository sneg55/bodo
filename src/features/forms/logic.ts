// Conditional visibility and track routing, pure so the same code runs in both
// places BUILD_SPEC section 5.1 requires it: client-side while the speaker fills,
// server-side again on submit. Two implementations of one condition is how a form
// validates a question nobody was shown, or silently drops one that was answered.

import type { RecordId } from '@/types/domain'
import type { FieldCondition, FormField, RoutingConfig } from '@/types/forms'

// Length measurement moved to ./answer-length.ts when this file crossed the size limit, and
// is re-exported here so every existing import still resolves.
export { answerLength } from '@/features/forms/answer-length'

/** Answers as they sit in `Submissions.answersJson`, keyed by `FormField.id`. */
export type FormAnswers = Readonly<Record<string, unknown>>

/**
 * Answers are read through a Map rather than by indexing the record directly.
 * A dynamic index on a plain object also reaches inherited keys, so
 * `answers['constructor']` would come back as an "answer" for a field whose id
 * happened to collide with a prototype member.
 */
export function answerIndex(answers: FormAnswers): ReadonlyMap<string, unknown> {
  return new Map(Object.entries(answers))
}

/**
 * An answer flattened to comparable strings. Condition values are authored as
 * strings in the builder while an answer can be a number, a boolean or a
 * multiselect array, so the two have to meet somewhere.
 */
export function answerValues(answer: unknown): readonly string[] {
  if (answer === undefined || answer === null) return []
  if (Array.isArray(answer)) {
    const items: readonly unknown[] = answer
    return items.flatMap((item) => answerValues(item))
  }
  if (typeof answer === 'string') {
    const trimmed = answer.trim()
    return trimmed.length === 0 ? [] : [trimmed]
  }
  if (typeof answer === 'number' || typeof answer === 'boolean') return [String(answer)]
  // Files and other objects carry no value a condition can compare against.
  return []
}

/**
 * The same values, but as the labels a person chose rather than what is stored.
 *
 * `answerValues` is right for comparing a condition and wrong for showing anybody: a
 * choice answer stores the option's `value`, which for Track and Tags is an Airtable
 * record id. The CFP wizard's Review step recapped a speaker's own answers as
 * `Tags: recAj3y7ITWrXBvUD` and `Format: workshop` because it printed the stored form.
 *
 * A value with no matching option passes through unchanged, which is what makes this safe
 * on every field: a text or number answer has no options and is already its own label.
 */
export function answerLabels(
  field: { readonly options?: readonly { readonly value: string; readonly label: string }[] },
  answer: unknown,
): readonly string[] {
  const labelFor = new Map((field.options ?? []).map((option) => [option.value, option.label]))
  return answerValues(answer).map((value) => labelFor.get(value) ?? value)
}

export function isAnswered(answer: unknown): boolean {
  // An unchecked checkbox arrives as `false`, which is a value but not an answer:
  // the only reason to mark a checkbox required is consent, and consent has to be
  // given rather than merely submitted.
  if (answer === false) return false
  return answerValues(answer).length > 0
}

function equalsValue(answer: unknown, expected: FieldCondition['value']): boolean {
  if (typeof expected !== 'string') return false
  // `includes` rather than an equality check so a condition can point at one
  // option of a multiselect, whose answer is a set rather than a scalar.
  return answerValues(answer).includes(expected)
}

function isOneOf(answer: unknown, expected: FieldCondition['value']): boolean {
  const wanted = typeof expected === 'string' ? [expected] : (expected ?? [])
  return answerValues(answer).some((value) => wanted.includes(value))
}

/**
 * The controlling answer a condition should be evaluated against.
 *
 * A checkbox is TOTAL: it is either checked or unchecked, and there is no third state a rule
 * could reasonably wait for. But an untouched one has no entry in the answer record at all
 * (`CheckboxControl` only writes on change), so `eq "false"` compared against `undefined`
 * matched nothing and a question conditioned on "unchecked" stayed hidden until the speaker
 * checked the box and unchecked it again, with the box visibly unchecked the whole time. Absent
 * therefore reads as `false` for a checkbox and only for a checkbox. Found by Codex review.
 *
 * `answered` is unaffected: `isAnswered(false)` is already false, because the only reason to
 * require a checkbox is consent and consent has to be given rather than merely submitted.
 */
function conditionAnswer(controller: FormField | undefined, raw: unknown): unknown {
  if (raw !== undefined) return raw
  return controller?.type === 'checkbox' ? false : undefined
}

/**
 * `neq` is deliberately the negation of `eq`, which means it holds while the
 * controlling field is still blank. That is the reading the builder UI implies
 * ("show unless they picked X"), and the alternative hides the dependent question
 * until an unrelated one is touched.
 */
function matchesCondition(condition: FieldCondition, answer: unknown): boolean {
  switch (condition.op) {
    case 'answered':
      return isAnswered(answer)
    case 'eq':
      return equalsValue(answer, condition.value)
    case 'neq':
      return !equalsValue(answer, condition.value)
    case 'in':
      return isOneOf(answer, condition.value)
  }
}

/**
 * The visible subset, in definition order, which is the order the form renders
 * and the order the review screen reads answers back in.
 *
 * The contract is one dependency level (section 5.1), but the controller's own
 * visibility is resolved recursively and memoised rather than assumed. So a
 * deeper chain that a hand-edited `fieldsJson` could still contain resolves
 * consistently instead of half-evaluating, and a hidden controller hides its
 * dependents at any depth.
 */
export function visibleFields(
  fields: readonly FormField[],
  answers: FormAnswers,
): readonly FormField[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const index = answerIndex(answers)
  const decided = new Map<string, boolean>()
  const inProgress = new Set<string>()

  function visible(field: FormField): boolean {
    const already = decided.get(field.id)
    if (already !== undefined) return already
    // A cycle (A shows if B, B shows if A) is a builder mistake that must not
    // hang the wizard. Break it by showing the field: a surplus question is
    // recoverable, a dropped required one is not.
    if (inProgress.has(field.id)) return true
    inProgress.add(field.id)
    const result = evaluate(field)
    inProgress.delete(field.id)
    decided.set(field.id, result)
    return result
  }

  function evaluate(field: FormField): boolean {
    const condition = field.showIf
    if (condition === undefined) return true
    const controller = byId.get(condition.fieldId)
    // Dangling reference: the controlling field was deleted from the form. Show
    // the question, because hiding it strips the answer silently and leaves a
    // required field impossible to satisfy.
    if (controller === undefined) return true
    if (controller.id !== field.id && !visible(controller)) return false
    return matchesCondition(condition, conditionAnswer(controller, index.get(condition.fieldId)))
  }

  return fields.filter((field) => visible(field))
}

/**
 * The stripped answer set section 5.1 calls for: the answers of the fields that are
 * visible right now, and nothing else.
 *
 * Two kinds of answer are dropped, and neither is hypothetical. A stale hidden one,
 * where the speaker answered a conditional question and then changed the answer that
 * controlled it, would otherwise be stored as an answer to a question they were not
 * shown. An undeclared one, where a key names no field of this form, can only come
 * from a payload the wizard did not build, since the public submit is an open POST.
 *
 * Emptiness is not visibility: an unchecked `false` is kept, because clearing an
 * answer and never giving one are different facts to the record it writes to.
 */
export function sanitizeAnswers(fields: readonly FormField[], answers: FormAnswers): FormAnswers {
  const declared = new Set(visibleFields(fields, answers).map((field) => field.id))
  return Object.fromEntries(Object.entries(answers).filter(([id]) => declared.has(id)))
}

/**
 * The track a routing RULE selected, and `undefined` when none of them fired.
 *
 * The default track is deliberately NOT applied here, and that is the whole point of
 * the function's shape. It used to return `routing.defaultTrackId` on the way out,
 * which made "a rule chose this track" and "nothing matched" indistinguishable to the
 * caller. `prepare.ts` composed it as `routeToTrack(...) ?? columns.trackId`, so the
 * `??` could never fire, an answered Track question could never win, and every
 * submission on the seeded form landed under its default track no matter what the
 * speaker picked. Precedence belongs to the caller, which is the only place that knows
 * whether the speaker was asked at all.
 *
 * Takes the fields rather than a pre-stripped answer set and strips them itself, so
 * routing off a hidden field's stale answer is not something a caller can opt into:
 * that would file the submission under a track the speaker never chose.
 */
export function matchedTrackId(
  routing: RoutingConfig,
  fields: readonly FormField[],
  answers: FormAnswers,
): RecordId | undefined {
  const index = answerIndex(sanitizeAnswers(fields, answers))
  const byId = new Map(fields.map((field) => [field.id, field]))
  for (const rule of routing.rules) {
    // Same absent-means-unchecked reading as `visibleFields`, so a track rule on a checkbox
    // does not route differently from a visibility rule on the same question.
    const answer = conditionAnswer(byId.get(rule.when.fieldId), index.get(rule.when.fieldId))
    if (matchesCondition(rule.when, answer)) return rule.trackId
  }
  return undefined
}
