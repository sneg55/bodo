// What is stopping the speaker from moving on, per step.
//
// The StepWizard shell gates Next with `disabled` (BUILD_SPEC section 5.0), and a
// disabled button with no explanation is the worst version of that, so every blocker
// is a message the step renders next to the control as well.
//
// These call the same `visibleFields`, `validateAnswers` and `validateParticipants`
// the Server Action calls. That is the entire reason those modules are pure: a second
// client-side evaluator would eventually disagree with the server, and the failure
// mode is a wizard that lets you press Submit and a server that says no.

import { isAnswered } from '@/features/forms/logic'
import type { Problem } from '@/features/forms/validate'
import {
  ProblemCodes,
  validateAnswers,
  validateCrossFieldLimits,
  validateParticipants,
} from '@/features/forms/validate'
import { withIdentityAnswers } from '@/features/submissions/participants'
import type { PublicForm } from '@/features/submissions/public-form'
import type {
  WizardParticipant,
  WizardState,
  WizardStepKey,
} from '@/features/submissions/wizard-state'

/** Loose on purpose: the authority is `field-checks.ts`, this only gates the button. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function accountProblems(state: WizardState): readonly Problem[] {
  const problems: Problem[] = []
  const email = state.email.trim()
  if (email.length === 0) {
    problems.push({ code: ProblemCodes.REQUIRED, message: 'Your Email Address is required.' })
  } else if (!EMAIL_SHAPE.test(email)) {
    problems.push({
      code: ProblemCodes.EMAIL_INVALID,
      message: 'Your Email Address is not a valid email address.',
    })
  }
  if (state.firstName.trim().length === 0) {
    problems.push({ code: ProblemCodes.REQUIRED, message: 'First Name is required.' })
  }
  if (state.lastName.trim().length === 0) {
    problems.push({ code: ProblemCodes.REQUIRED, message: 'Last Name is required.' })
  }
  return problems
}

export function submissionProblems(form: PublicForm, state: WizardState): readonly Problem[] {
  return [
    ...validateAnswers(form.fields, state.answers),
    // Only the submission-scoped limits here. A `perParticipant` rule is reported on
    // the Participant step, next to the biography that is over budget.
    ...validateCrossFieldLimits(
      form.crossFieldLimits.filter((limit) => !limit.perParticipant),
      state.answers,
      [],
      form.fields,
    ),
  ]
}

export function participantProblems(form: PublicForm, state: WizardState): readonly Problem[] {
  if (!form.participantsEnabled) return []
  const problems: Problem[] = [
    ...validateParticipants(form.roles, state.participants),
    ...validateCrossFieldLimits(
      form.crossFieldLimits.filter((limit) => limit.perParticipant),
      state.answers,
      state.participants.map((participant) => ({
        participantId: participant.key,
        answers: participantAnswers(form, participant),
      })),
      form.participantFields,
    ),
  ]

  for (const participant of state.participants) {
    problems.push(...oneParticipantProblems(form, participant))
  }
  return problems
}

/**
 * The participant's own answers with the typed identity values filled in under their
 * field ids, which is the same merge the server does. Without it a locked, required
 * Email question reports as missing on a participant whose email is right there.
 */
export function participantAnswers(
  form: PublicForm,
  participant: WizardParticipant,
): Record<string, unknown> {
  return {
    ...withIdentityAnswers({
      fields: form.participantFields,
      identity: {
        email: participant.email,
        firstName: participant.firstName,
        lastName: participant.lastName,
      },
      answers: participant.answers,
    }),
  }
}

function oneParticipantProblems(
  form: PublicForm,
  participant: WizardParticipant,
): readonly Problem[] {
  const problems: Problem[] = []
  const name = participantLabel(participant)

  if (participant.email.trim().length === 0) {
    problems.push({
      participantId: participant.key,
      code: ProblemCodes.REQUIRED,
      message: `Email is required for ${name}.`,
    })
  }
  for (const problem of validateAnswers(
    form.participantFields,
    participantAnswers(form, participant),
  )) {
    problems.push({ ...problem, participantId: participant.key })
  }
  return problems
}

/** A name if there is one, otherwise something the speaker can locate in the list. */
export function participantLabel(participant: WizardParticipant): string {
  const name = `${participant.firstName} ${participant.lastName}`.trim()
  if (name.length > 0) return name
  if (participant.email.trim().length > 0) return participant.email.trim()
  return 'this participant'
}

/**
 * Blockers for one step. Welcome and Review never block: Welcome asks nothing, and
 * Review's own gate is the union of the steps behind it, which is what `submitBlockers`
 * reports so the Submit button and the Next buttons cannot disagree.
 */
export function stepProblems(
  form: PublicForm,
  state: WizardState,
  step: WizardStepKey,
): readonly Problem[] {
  switch (step) {
    case 'welcome':
      return []
    case 'account':
      return accountProblems(state)
    case 'submission':
      return submissionProblems(form, state)
    case 'participant':
      return participantProblems(form, state)
    case 'review':
      return submitProblems(form, state)
  }
}

export function submitProblems(form: PublicForm, state: WizardState): readonly Problem[] {
  return [
    ...accountProblems(state),
    ...submissionProblems(form, state),
    ...participantProblems(form, state),
  ]
}

/**
 * Answered questions, in the form's own order, for the Review recap. Unanswered
 * optional questions are left out rather than shown blank: a recap of empty rows is
 * harder to check than a short list of what was actually said.
 */
export function answeredSummary(
  fields: readonly { id: string; label: string }[],
  answers: Record<string, unknown>,
  visible: readonly { id: string }[],
): readonly { id: string; label: string; value: unknown }[] {
  const shown = new Set(visible.map((field) => field.id))
  const index = new Map(Object.entries(answers))
  return fields
    .filter((field) => shown.has(field.id) && isAnswered(index.get(field.id)))
    .map((field) => ({ id: field.id, label: field.label, value: index.get(field.id) }))
}
