// Does this answer even have the type its field declares? The public CFP submit is
// an open POST (BUILD_SPEC section 5.1 requires the server to re-validate), so the
// payload is whatever a client chose to send, not whatever the wizard renders.
//
// This runs before the content checks in field-checks.ts, because every one of them
// reads the answer through `answerValues`, which flattens an array and stringifies
// a boolean. That is right for comparing a condition and wrong for validating a
// value: it makes `['talk']` a member of a dropdown's option set and the string
// "false" a given consent. Content validation only means something once the value
// is the shape it claims to be.

import type { ProblemCode } from '@/features/forms/problems'
import { type Problem, ProblemCodes } from '@/features/forms/problems'
import type { FieldType, FormField } from '@/types/forms'

/** What a rule reports, with the label filled in by the caller that has the field. */
type ShapeFailure = {
  code: ProblemCode
  message: (label: string) => string
}

type ShapeRule = (answer: unknown) => ShapeFailure | undefined

function failure(code: ProblemCode, text: (label: string) => string): ShapeFailure {
  return { code, message: text }
}

const NOT_TEXT = failure(ProblemCodes.SHAPE_INVALID, (label) => `${label} must be text.`)
const NOT_BOOLEAN = failure(
  ProblemCodes.SHAPE_INVALID,
  (label) => `${label} must be checked or unchecked.`,
)
const NOT_LIST = failure(
  ProblemCodes.SHAPE_INVALID,
  (label) => `${label} must be a list of choices.`,
)
const NOT_SINGLE = failure(
  ProblemCodes.SHAPE_INVALID,
  (label) => `${label} must be a single choice.`,
)
const NOT_TIMESTAMP = failure(
  ProblemCodes.SHAPE_INVALID,
  (label) => `${label} must be a date and time.`,
)
// A number of the wrong TYPE keeps the shape code; a string that is simply not
// numeric keeps NUMBER_INVALID, which is the message the wizard already renders
// beside a number input. Two codes for one mistake would show two messages.
const NOT_A_NUMBER = failure(ProblemCodes.SHAPE_INVALID, (label) => `${label} must be a number.`)
const NOT_NUMERIC = failure(ProblemCodes.NUMBER_INVALID, (label) => `${label} must be a number.`)

/**
 * What a number input can actually produce. Deliberately narrower than `Number()`,
 * which reads `0x10` as 16 and `1e3` as 1000: neither is a value a speaker typed,
 * and both reach Airtable as a number nobody chose.
 */
const NUMERIC_TEXT = /^-?\d*\.?\d+$/

const requireText: ShapeRule = (answer) => (typeof answer === 'string' ? undefined : NOT_TEXT)

const requireBoolean: ShapeRule = (answer) =>
  typeof answer === 'boolean' ? undefined : NOT_BOOLEAN

const requireStringList: ShapeRule = (answer) => {
  if (!Array.isArray(answer)) return NOT_LIST
  const items: readonly unknown[] = answer
  return items.every((item) => typeof item === 'string') ? undefined : NOT_LIST
}

const requireSingleChoice: ShapeRule = (answer) =>
  typeof answer === 'string' ? undefined : NOT_SINGLE

const requireTimestamp: ShapeRule = (answer) => {
  if (typeof answer !== 'string') return NOT_TIMESTAMP
  return Number.isNaN(Date.parse(answer)) ? NOT_TIMESTAMP : undefined
}

const requireNumber: ShapeRule = (answer) => {
  if (typeof answer === 'number') return Number.isFinite(answer) ? undefined : NOT_A_NUMBER
  // A form post carries strings, so a numeric string is the normal case rather
  // than a tolerated one.
  if (typeof answer === 'string') return NUMERIC_TEXT.test(answer.trim()) ? undefined : NOT_NUMERIC
  return NOT_A_NUMBER
}

/**
 * `file` and `speaker_headshot` are absent on purpose: their answer is a reference
 * written by the R2 upload path rather than something a speaker types, and an
 * object answer is already treated as unanswered by `isAnswered`. Adding a rule
 * here would guess at a shape this module does not own.
 */
const TEXT_TYPES: readonly FieldType[] = [
  'text',
  'wysiwyg',
  'email',
  'phone',
  'url',
  'video',
  'speaker_bio',
]

const SHAPE_RULES: ReadonlyMap<FieldType, ShapeRule> = new Map<FieldType, ShapeRule>([
  ...TEXT_TYPES.map((type): [FieldType, ShapeRule] => [type, requireText]),
  ['checkbox', requireBoolean],
  ['multiselect', requireStringList],
  ['select', requireSingleChoice],
  ['radio', requireSingleChoice],
  ['datetime', requireTimestamp],
  ['number', requireNumber],
])

/**
 * Only ever called with an answer that `isAnswered` already accepted, and its
 * problems suppress the content checks: see the note at the top of the file.
 */
export function checkShape(field: FormField, answer: unknown): readonly Problem[] {
  const rule = SHAPE_RULES.get(field.type)
  if (rule === undefined) return []
  const problem = rule(answer)
  if (problem === undefined) return []
  return [{ fieldId: field.id, code: problem.code, message: problem.message(field.label) }]
}
