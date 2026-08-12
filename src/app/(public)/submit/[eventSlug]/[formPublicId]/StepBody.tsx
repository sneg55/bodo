'use client'

// Which step the wizard is showing, and the state updates each one asks for.
//
// Split out of SubmitWizard when that file passed the size limit. It is the natural seam:
// everything here is presentational dispatch over one `step`, where the file it came from
// owns the state, the persistence and the gate.

import type { Problem } from '@/features/forms/validate'
import type { PublicForm } from '@/features/submissions/public-form'
import type { WizardState, WizardStepKey } from '@/features/submissions/wizard-state'
import {
  firstEnabledRole,
  newParticipant,
  removeParticipant,
  setAnswer,
  setParticipantAnswer,
  setPrimary,
  setSubmitterIdentity,
  updateParticipant,
} from '@/features/submissions/wizard-state'

import { AccountStep } from './AccountStep'
import { ParticipantStep } from './ParticipantStep'
import { ReviewStep } from './ReviewStep'
import { SubmissionStep } from './SubmissionStep'
import { WelcomeStep } from './WelcomeStep'

export type StepBodyProps = {
  form: PublicForm
  state: WizardState
  step: WizardStepKey
  problems: readonly Problem[]
  /** The address this browser has proved, resolved server-side. See AccountStep. */
  signedInEmail?: string
  loginHref: string
  setState: (update: (previous: WizardState) => WizardState) => void
}

export function StepBody({
  form,
  state,
  step,
  problems,
  signedInEmail,
  loginHref,
  setState,
}: StepBodyProps) {
  switch (step) {
    case 'welcome':
      return <WelcomeStep form={form} />
    case 'account':
      return (
        <AccountStep
          state={state}
          signedInEmail={signedInEmail}
          loginHref={loginHref}
          // Not a spread onto the state. The Account step's identity has to reach the
          // primary participant it seeded, or the Review step recaps two different people.
          onChange={(patch) => setState((previous) => setSubmitterIdentity(previous, patch))}
        />
      )
    case 'submission':
      return (
        <SubmissionStep
          form={form}
          state={state}
          problems={problems}
          onAnswer={(fieldId, value) => setState((previous) => setAnswer(previous, fieldId, value))}
        />
      )
    case 'participant':
      return (
        <ParticipantStep
          form={form}
          state={state}
          problems={problems}
          onPatch={(key, patch) => setState((previous) => updateParticipant(previous, key, patch))}
          onAnswer={(key, fieldId, value) =>
            setState((previous) => setParticipantAnswer(previous, key, fieldId, value))
          }
          onPrimary={(key) => setState((previous) => setPrimary(previous, key))}
          onRemove={(key) => setState((previous) => removeParticipant(previous, key))}
          onAdd={() =>
            setState((previous) => ({
              ...previous,
              participants: [
                ...previous.participants,
                newParticipant({
                  role: firstEnabledRole(form),
                  isPrimary: previous.participants.length === 0,
                }),
              ],
            }))
          }
        />
      )
    case 'review':
      return <ReviewStep form={form} state={state} />
  }
}
