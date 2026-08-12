// A form task's answers, between the shape they are stored in and the shape the shared field
// renderer binds to.
//
// `TaskAssignments.answersJson` is a bare `Record<string, unknown>` keyed by `FormField.id`
// (BUILD_SPEC 5.6: "answers into TaskAssignments.answersJson"), and `FieldControl` binds to the
// same keys, so the conversion is almost the identity. Almost is the whole reason this module
// exists, because three things are not:
//
//   - A stored answer whose question is no longer on the form. The organizer deleted a
//     question after the speaker answered it. `visibleFields` never sees the key, so it would
//     be carried invisibly through every later save and re-stored forever. Dropped on the way
//     in, which is the same rule `sanitizeAnswers` applies on the way out.
//   - A form task whose linked form is gone, or which links no form at all. There are no
//     fields to render, so there are no answers, and the correct reading is an empty set
//     rather than the stored blob passed through to controls that do not exist.
//   - The difference between SAVING and COMPLETING. A save is allowed to leave a required
//     question blank, which is the entire point of a save: a speaker filling in a long form
//     wants their work kept before they have finished it. A completion is not. Both use
//     `validateAnswers`, and the save then drops the required-blank problems rather than
//     skipping validation, so a badly-formed email or an over-length answer is still caught
//     before it is stored.
//
// Pure, and tested in tests/portal-forms-answers.test.ts.

import type { FormAnswers } from '@/features/forms/logic'
import { sanitizeAnswers } from '@/features/forms/logic'
import { type Problem, ProblemCodes, validateAnswers } from '@/features/forms/validate'
import type { FormField } from '@/types/forms'

/**
 * The stored answers, restricted to the questions the form still asks.
 *
 * Declared-but-hidden answers are KEPT, unlike `sanitizeAnswers`, and the difference matters:
 * this is the value the controls open with, and a conditional question's answer has to survive
 * a round trip through the editor while its controller is still being decided. Stripping the
 * hidden ones is the job of the write, where `sanitizeAnswers` already does it.
 */
export function answersForFields(
  fields: readonly FormField[],
  stored: Record<string, unknown> | undefined,
): FormAnswers {
  if (stored === undefined) return {}
  const declared = new Set(fields.map((field) => field.id))
  return Object.fromEntries(Object.entries(stored).filter(([id]) => declared.has(id)))
}

/**
 * Problems that block a SAVE. Required-blank is not one of them.
 *
 * Filtered by code rather than by re-implementing the walk, so the shape checks, the option
 * checks, the character caps and the conditional-visibility rule are the same ones the
 * completion runs. A save that skipped validation entirely would store an answer that the
 * completion then refuses, and the speaker would meet the refusal on a form they had been told
 * was saved.
 */
export function partialAnswerProblems(
  fields: readonly FormField[],
  answers: FormAnswers,
): readonly Problem[] {
  return validateAnswers(fields, answers).filter(
    (problem) => problem.code !== ProblemCodes.REQUIRED,
  )
}

/**
 * What a save stores: the visible, declared answers and nothing else.
 *
 * `sanitizeAnswers` rather than the raw draft, for the reason its own header gives. A speaker
 * who answered a conditional question and then changed the answer that controlled it must not
 * have the stale answer filed as one they gave, and a Server Action is an open POST target so
 * an undeclared key can arrive from something the portal did not render.
 */
export function answersToStore(fields: readonly FormField[], answers: FormAnswers): FormAnswers {
  return sanitizeAnswers(fields, answers)
}
