// Per-field checks for one non-empty answer: length cap, declared options, and
// format. Split out of validate.ts to keep both files inside the size limit, and
// it is the half that grows as field types are added.
//
// Content only, and only for an answer whose shape shape-checks.ts already
// accepted. `number` lives there rather than here because "is this a number" is a
// question about the value's type, and answering it off the stringified form let
// `0x10` through as 16.

import { answerLength, answerValues } from '@/features/forms/logic'
import type { ProblemCode } from '@/features/forms/problems'
import { type Problem, ProblemCodes } from '@/features/forms/problems'
import { DEFAULT_MAX_LEN, type FieldType, type FormField } from '@/types/forms'

// `DEFAULT_MAX_LEN` read through a Map, since indexing it with `field.type` is a
// dynamic index on a Record.
const DEFAULT_MAX_LEN_BY_TYPE: ReadonlyMap<FieldType, number> = new Map(
  Object.entries(DEFAULT_MAX_LEN).map(([type, cap]) => [type as FieldType, cap]),
)

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const HTTP_URL_SHAPE = /^https?:\/\/[^\s/$.?#][^\s]*$/i

function isHttpUrl(value: string): boolean {
  return HTTP_URL_SHAPE.test(value)
}

type FormatRule = {
  code: ProblemCode
  message: (label: string) => string
  test: (value: string) => boolean
}

// `video` holds a link rather than an upload (section 5.1b) and non-embeddable
// hosts are accepted as plain links, so the only thing left to reject is a value
// that is not a URL at all. It keeps its own code so the wizard can say "paste a
// YouTube, Vimeo, Loom or Drive link" beside the right control.
const FORMAT_RULES: ReadonlyMap<FieldType, FormatRule> = new Map([
  [
    'email',
    {
      code: ProblemCodes.EMAIL_INVALID,
      message: (label: string) => `${label} is not a valid email address.`,
      test: (value: string) => EMAIL_SHAPE.test(value),
    },
  ],
  [
    'url',
    {
      code: ProblemCodes.URL_INVALID,
      message: (label: string) => `${label} must be a link starting with http:// or https://.`,
      test: isHttpUrl,
    },
  ],
  [
    'video',
    {
      code: ProblemCodes.VIDEO_URL_INVALID,
      message: (label: string) =>
        `${label} must be a video link starting with http:// or https://.`,
      test: isHttpUrl,
    },
  ],
])

const OPTION_TYPES: readonly FieldType[] = ['select', 'radio', 'multiselect']

/** Only ever called with an answer that `isAnswered` already accepted. */
export function checkAnswer(field: FormField, answer: unknown): readonly Problem[] {
  const problems: Problem[] = []
  const values = answerValues(answer)

  // An explicit cap wins; otherwise the type default applies, because the builder
  // stamps that same default onto the row and an uncapped long text is what fills
  // an Airtable long-text cell with 100k characters.
  const cap = field.maxLen ?? DEFAULT_MAX_LEN_BY_TYPE.get(field.type)
  // The field type decides whether markup is stripped before counting. Passing it is what
  // stops a plain text answer being measured as if its angle brackets were tags: see
  // MARKUP_TYPES in answer-length.ts.
  const length = answerLength(answer, field.type)
  if (cap !== undefined && length > cap) {
    problems.push({
      fieldId: field.id,
      code: ProblemCodes.MAX_LEN,
      message: `${field.label} is ${length} characters, over the ${cap} character limit.`,
    })
  }

  problems.push(...checkOptions(field, values))

  const format = FORMAT_RULES.get(field.type)
  if (format !== undefined) {
    for (const value of values) {
      if (!format.test(value)) {
        problems.push({
          fieldId: field.id,
          code: format.code,
          message: format.message(field.label),
        })
      }
    }
  }

  return problems
}

function checkOptions(field: FormField, values: readonly string[]): readonly Problem[] {
  // No declared options means there is nothing to check against, not that every
  // value is wrong.
  const options = field.options
  if (!OPTION_TYPES.includes(field.type) || options === undefined) return []

  const allowed = new Set(options.map((option) => option.value))
  return values
    .filter((value) => !allowed.has(value))
    .map((value) => ({
      fieldId: field.id,
      code: ProblemCodes.OPTION_INVALID,
      message: `${value} is not an option for ${field.label}.`,
    }))
}
