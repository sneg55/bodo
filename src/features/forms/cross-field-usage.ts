// How much of a combined character budget is spent, for the live counter the public form
// shows beside the questions a rule spans.
//
// Pure and separate from `validateCrossFieldLimits`, which answers a different question: that
// one reports a rule the speaker has already broken, this one is what stops them breaking it,
// and the reference says both exist ("Submitters see a live combined counter"). They must
// agree about the arithmetic, so both count with `answerLength` over `answerIndex` and this
// module never sums anything of its own.
//
// A rule whose fields are all gone yields nothing rather than a `0 / 500` counter for a set of
// questions that is not on the form. `checkCrossFieldLimits` refuses to let that be authored;
// this is the render-time half, for a form that was edited after a rule was written.

import type { FormAnswers } from '@/features/forms/logic'
import { answerIndex, answerLength } from '@/features/forms/logic'
import type { CrossFieldLimit, FormField } from '@/types/forms'

export type CombinedUsage = {
  /** The spanned questions' labels, in form order, for the counter's own line. */
  labels: readonly string[]
  used: number
  maxLen: number
  over: boolean
}

/**
 * One entry per rule that still spans at least one question on this form.
 *
 * `fields` is the list the rule's ids point into: the form's own questions for a
 * submission-scoped rule, one participant's questions for a `perParticipant` one, which is
 * the same split `wizard-gating.ts` makes when it validates them.
 */
export function combinedUsage(
  limits: readonly CrossFieldLimit[],
  fields: readonly FormField[],
  answers: FormAnswers,
): readonly CombinedUsage[] {
  const index = answerIndex(answers)
  const usages: CombinedUsage[] = []

  for (const limit of limits) {
    const spanned = fields.filter((field) => limit.fieldIds.includes(field.id))
    if (spanned.length === 0) continue
    const used = spanned.reduce(
      (total, field) => total + answerLength(index.get(field.id), field.type),
      0,
    )
    usages.push({
      labels: spanned.map((field) => field.label),
      used,
      maxLen: limit.maxLen,
      over: used > limit.maxLen,
    })
  }

  return usages
}
