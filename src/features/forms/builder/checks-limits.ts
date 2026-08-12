// The two limit checks, split out of checks.ts for the line limit: how many people a form
// accepts, and the combined character budgets it spends.
//
// Both are the same class of bug as everything in checks.ts. A limit nothing can satisfy is
// silent in the builder and fatal at the last step of a form the speaker has already filled
// in, because the wizard enforces what is stored without ever explaining where it came from.

import type { BuilderProblem } from '@/features/forms/builder/problem'
import type { CrossFieldLimit, FormField, ParticipantRoleRule } from '@/types/forms'

/**
 * Role counts that no submission can satisfy.
 *
 * Errors rather than warnings, because each one publishes a form nobody can complete. The
 * zero-maximum case is the one Codex review found: the wizard always seeds one primary
 * participant and refuses to remove the last one, so `max: 0` on an enabled role is
 * rejected at the last step of a form the speaker has already filled in.
 */
export function checkRoleLimits(
  enabled: readonly ParticipantRoleRule[],
  step: number,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  for (const rule of enabled) {
    if (rule.max < 1) {
      problems.push({
        severity: 'error',
        step,
        message: 'An enabled role needs a maximum of at least one, or nobody can submit.',
      })
    } else if (rule.min > rule.max) {
      problems.push({
        severity: 'error',
        step,
        message: 'A role has a minimum above its maximum, so no number of people satisfies it.',
      })
    }
  }
  return problems
}

/**
 * Cross-field character limits, against the questions they span.
 *
 * Four ways a stored rule is not a rule, and every one of them is invisible on the public
 * form rather than reported there: `validateCrossFieldLimits` sums whatever field ids it is
 * given and finds nothing, so a broken rule caps nothing and the organizer believes it does.
 *
 *   - Fewer than two fields. A cap on one field is that field's own `maxLen`, which the
 *     control already shows a counter for; as a combined rule it is a second, invisible
 *     limit on the same box.
 *   - A cap of zero, which no answer satisfies. Stored as `maxLen: 0` it reads as "no
 *     budget", so the form cannot be submitted with any text in those fields at all.
 *   - A field that is not on the form any more, which sums to nothing.
 *   - The same field named twice, which double-counts what the speaker typed once.
 *
 * The scope is decided by `perParticipant`, because that is what the public form does with
 * it: a per-participant rule is measured inside each participant's own answers, so it can
 * only span PARTICIPANT questions, and a submission-scoped one can only span the abstract
 * questions.
 */
export function checkCrossFieldLimits(
  limits: readonly CrossFieldLimit[],
  fields: readonly FormField[],
  participantFields: readonly FormField[],
  step: number,
): readonly BuilderProblem[] {
  const abstractIds = new Set(fields.map((field) => field.id))
  const participantIds = new Set(participantFields.map((field) => field.id))

  return limits.flatMap((limit) =>
    oneCrossFieldLimit(limit, limit.perParticipant ? participantIds : abstractIds, step),
  )
}

function oneCrossFieldLimit(
  limit: CrossFieldLimit,
  scope: ReadonlySet<string>,
  step: number,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  const at = (message: string) => {
    problems.push({ severity: 'error', step, message })
  }

  if (limit.fieldIds.length < 2) {
    at('A combined character limit needs at least two questions to combine.')
  }
  if (!Number.isFinite(limit.maxLen) || limit.maxLen < 1) {
    at('A combined character limit of zero is not a limit, and nothing can satisfy it.')
  }
  if (new Set(limit.fieldIds).size !== limit.fieldIds.length) {
    at('A combined character limit names the same question twice, which counts it twice.')
  }

  const missing = limit.fieldIds.filter((fieldId) => !scope.has(fieldId)).length
  if (missing > 0) {
    const questions = missing === 1 ? 'a question' : `${String(missing)} questions`
    const where = limit.perParticipant ? 'participant' : 'submission'
    at(
      `A combined character limit spans ${questions} that is not among this form's ${where} questions.`,
    )
  }

  return problems
}
