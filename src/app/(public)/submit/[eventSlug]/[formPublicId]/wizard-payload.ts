// The wizard's state, as the shape the two Server Actions parse.
//
// Lifted out of SubmitWizard.tsx when that file passed the 300 line limit, and it is the
// only part of it that is a pure function of the state rather than a piece of the wizard's
// behaviour. Both callers (`submitCfp` and `saveCfpDraft`) must send the SAME shape, which
// is why it was one function there and stays one function here: a draft that stores a
// different cast from the submit is the defect `draft-cast.ts` exists to prevent.
//
// Trimming happens here rather than in the action because the action re-parses and
// re-validates everything anyway (`parseSubmitPayload`); this only makes what leaves the
// browser equal to what the visitor can see they typed.

import type { PublicForm } from '@/features/submissions/public-form'
import type { WizardState } from '@/features/submissions/wizard-state'

export function payloadFrom(form: PublicForm, state: WizardState): unknown {
  return {
    email: state.email.trim(),
    firstName: state.firstName.trim(),
    lastName: state.lastName.trim(),
    answers: state.answers,
    participants: form.participantsEnabled
      ? state.participants.map((participant) => ({
          key: participant.key,
          role: participant.role,
          isPrimary: participant.isPrimary,
          email: participant.email.trim(),
          firstName: participant.firstName.trim(),
          lastName: participant.lastName.trim(),
          answers: participant.answers,
        }))
      : [],
  }
}
