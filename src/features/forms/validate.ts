// Submit-time validation, returning problems instead of throwing. The wizard has
// to render each one next to the control that caused it and the server has to
// return the whole set at once, so a thrown AppError (ErrorIds.SUB_VALIDATION_FAIL,
// SUB_ROLE_COUNT_INVALID) would collapse a filled-in form into one message and
// stop at the first mistake.

import type { ParticipantRole } from '@/constants/status'
import { checkAnswer } from '@/features/forms/field-checks'
import type { FormAnswers } from '@/features/forms/logic'
import { answerIndex, answerLength, isAnswered, visibleFields } from '@/features/forms/logic'
import type { ParticipantAnswers, ParticipantInput } from '@/features/forms/problems'
import { type Problem, ProblemCodes, roleLabel } from '@/features/forms/problems'
import { checkShape } from '@/features/forms/shape-checks'
import type { CrossFieldLimit, FormField, ParticipantRoleRule } from '@/types/forms'

export type {
  ParticipantAnswers,
  ParticipantInput,
  Problem,
  ProblemCode,
} from '@/features/forms/problems'
export { ProblemCodes } from '@/features/forms/problems'

/**
 * Field-level problems for the visible fields only. A hidden field is not
 * validated (section 5.1), which is the whole reason validation runs off
 * `visibleFields` rather than the raw definition: a required question behind an
 * unmet condition must not block a submission.
 *
 * Takes the raw answers, because deciding what is visible is exactly what it does.
 * It does not remove anything: stripping hidden and undeclared answers is
 * `sanitizeAnswers`, and a caller that persists or routes has to apply it. This
 * function reporting no problems is not a statement that the object it was handed
 * is safe to store.
 */
export function validateAnswers(
  fields: readonly FormField[],
  answers: FormAnswers,
): readonly Problem[] {
  const index = answerIndex(answers)
  const problems: Problem[] = []

  for (const field of visibleFields(fields, answers)) {
    const answer = index.get(field.id)
    if (!isAnswered(answer)) {
      if (field.required) {
        problems.push({
          fieldId: field.id,
          code: ProblemCodes.REQUIRED,
          message: `${field.label} is required.`,
        })
      }
      // Nothing else is checkable about a blank answer, and an optional blank is
      // not a problem at all.
      continue
    }
    const shape = checkShape(field, answer)
    if (shape.length > 0) {
      // Content checks read the answer flattened to strings, so running them on a
      // wrong-typed value produces confident nonsense: see shape-checks.ts.
      problems.push(...shape)
      continue
    }
    problems.push(...checkAnswer(field, answer))
  }

  return problems
}

/**
 * Per-role counts plus the one rule that is not expressible as a count: exactly
 * one primary. Without it a cast of three co-speakers has nobody to address the
 * confirmation email to, and two primaries make the portal owner ambiguous.
 */
export function validateParticipants(
  roles: readonly ParticipantRoleRule[],
  participants: readonly ParticipantInput[],
): readonly Problem[] {
  const problems: Problem[] = []
  const counts = new Map<ParticipantRole, number>()
  for (const participant of participants) {
    counts.set(participant.role, (counts.get(participant.role) ?? 0) + 1)
  }

  for (const rule of roles) {
    problems.push(...checkRoleCount(rule, counts.get(rule.role) ?? 0))
  }

  const enabled = new Set(roles.filter((rule) => rule.enabled).map((rule) => rule.role))
  for (const [role, count] of counts) {
    if (!enabled.has(role)) {
      problems.push({
        role,
        code: ProblemCodes.ROLE_NOT_ENABLED,
        message: `This form does not accept a ${roleLabel(role)} (${count} added).`,
      })
    }
  }

  problems.push(...checkPrimary(participants))
  return problems
}

function checkRoleCount(rule: ParticipantRoleRule, count: number): readonly Problem[] {
  // A disabled role is reported once, by the not-enabled sweep above, so its min
  // of 0 does not fire here as well.
  if (!rule.enabled) return []
  const label = roleLabel(rule.role)
  if (count < rule.min) {
    return [
      {
        role: rule.role,
        code: ProblemCodes.ROLE_MIN,
        message: `Add at least ${rule.min} ${label} (${count} added).`,
      },
    ]
  }
  if (count > rule.max) {
    return [
      {
        role: rule.role,
        code: ProblemCodes.ROLE_MAX,
        message: `At most ${rule.max} ${label} allowed (${count} added).`,
      },
    ]
  }
  return []
}

function checkPrimary(participants: readonly ParticipantInput[]): readonly Problem[] {
  // An empty cast already fails its minimums. Adding "mark someone primary" to
  // that points at a control the speaker cannot reach yet.
  if (participants.length === 0) return []
  const primaries = participants.filter((participant) => participant.isPrimary)
  if (primaries.length === 0) {
    return [{ code: ProblemCodes.PRIMARY_MISSING, message: 'Mark one participant as primary.' }]
  }
  if (primaries.length > 1) {
    return [
      {
        code: ProblemCodes.PRIMARY_DUPLICATE,
        message: `Only one participant can be primary (${primaries.length} marked).`,
      },
    ]
  }
  return []
}

/**
 * Combined character limits across a named set of fields. `perParticipant` rules
 * are measured within each participant's own answers, so one long biography does
 * not spend the next speaker's budget. With no participant answers supplied the
 * rule still applies to the submission's own answers, which is the solo case the
 * wizard hits before anyone else is added.
 */
export function validateCrossFieldLimits(
  limits: readonly CrossFieldLimit[],
  answers: FormAnswers,
  participants: readonly ParticipantAnswers[] = [],
  /**
   * The fields the limits span, submission and participant alike, only so their TYPES are
   * known: `answerLength` strips markup for a rich text field and counts every character
   * otherwise, and the client-side counter in `cross-field-usage.ts` already passes the type.
   * Without this the two would disagree the moment a limit spanned a rich text field, which
   * is the failure that counter exists to prevent.
   *
   * Defaulted to empty, and an unknown field is then measured verbatim. That is the safe
   * direction: it refuses an answer the counter allowed rather than accepting one it refused.
   */
  fields: readonly FormField[] = [],
): readonly Problem[] {
  const problems: Problem[] = []
  const typeById = new Map(fields.map((field) => [field.id, field.type]))

  for (const limit of limits) {
    if (limit.perParticipant && participants.length > 0) {
      for (const participant of participants) {
        problems.push(
          ...checkCombined(limit, participant.answers, participant.participantId, typeById),
        )
      }
      continue
    }
    problems.push(...checkCombined(limit, answers, undefined, typeById))
  }

  return problems
}

function checkCombined(
  limit: CrossFieldLimit,
  answers: FormAnswers,
  participantId: string | undefined,
  typeById: ReadonlyMap<string, FormField['type']>,
): readonly Problem[] {
  const index = answerIndex(answers)
  let used = 0
  for (const fieldId of limit.fieldIds) {
    used += answerLength(index.get(fieldId), typeById.get(fieldId))
  }
  if (used <= limit.maxLen) return []
  return [
    {
      fieldIds: limit.fieldIds,
      participantId,
      code: ProblemCodes.CROSS_FIELD_MAX_LEN,
      message: `These fields total ${used} characters, over the combined ${limit.maxLen} character limit.`,
    },
  ]
}
