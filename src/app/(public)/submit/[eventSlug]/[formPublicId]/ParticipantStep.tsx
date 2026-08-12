'use client'

// Step 4: the cast, and the per-role minima and maxima the organizer configured.
//
// A solo speaker MUST be able to submit. BUILD_SPEC section 5.1 spends a paragraph on
// this, because the organizer walkthrough hit a validation wall on his own form and
// said "obviously I should not have a minimum of two speakers, that's not something
// that we do". So the step arrives with the submitter already added as the primary,
// and the default role set (`DEFAULT_PARTICIPANT_ROLES`, min 1 max 1 speaker) is
// satisfied by that alone: no speaker has to understand the roles panel to submit.
//
// The overall cap is derived, not stored: the sum of the enabled roles' maxima. There
// is no screenshot of an overall control, so inventing a column for one would be
// inventing a product decision. See BUILD_SPEC section 5.1.

import { PlusIcon } from 'lucide-react'
import { OrganizerHtml } from '@/components/primitives/OrganizerHtml'
import { Button } from '@/components/ui/button'
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import type { Problem } from '@/features/forms/validate'
import type { PublicForm } from '@/features/submissions/public-form'
import type { WizardParticipant, WizardState } from '@/features/submissions/wizard-state'
import { ParticipantRow } from './ParticipantRow'

const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export type ParticipantStepProps = {
  form: PublicForm
  state: WizardState
  problems: readonly Problem[]
  onPatch: (key: string, patch: Partial<Omit<WizardParticipant, 'key'>>) => void
  onAnswer: (key: string, fieldId: string, value: unknown) => void
  onPrimary: (key: string) => void
  onRemove: (key: string) => void
  onAdd: () => void
}

export function ParticipantStep(props: ParticipantStepProps) {
  const { form, state, problems } = props
  const cap = form.roles.reduce((total, rule) => total + rule.max, 0)
  const atCap = state.participants.length >= cap

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* The organizer's Section Title from the builder's step 4 ("Tell us about you"),
            falling back to the transcribed default when they have not written one. */}
        <h2 className="text-lg font-semibold">{form.participantSectionTitle ?? 'Participants'}</h2>
        <OrganizerHtml html={form.participantSectionHtml} />
        <p className="text-sm text-muted-foreground">
          Everyone presenting this submission. The primary participant receives the confirmation
          email and owns the submission in the speaker portal.
        </p>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {form.roles.map((rule) => (
          <li key={rule.role}>
            {`${ROLE_LABELS.get(rule.role) ?? rule.role}: ${roleRule(rule.min, rule.max)}`}
          </li>
        ))}
      </ul>

      {state.participants.map((participant, index) => (
        <ParticipantRow
          key={participant.key}
          form={form}
          participant={participant}
          index={index}
          problems={problems.filter((problem) => problem.participantId === participant.key)}
          // The last remaining participant cannot be removed: an empty cast has no
          // primary, so removing it would only produce a problem the speaker then has
          // to undo.
          removable={state.participants.length > 1}
          onPatch={(patch) => props.onPatch(participant.key, patch)}
          onAnswer={(fieldId, value) => props.onAnswer(participant.key, fieldId, value)}
          onPrimary={() => props.onPrimary(participant.key)}
          onRemove={() => props.onRemove(participant.key)}
        />
      ))}

      <div>
        <Button type="button" variant="outline" disabled={atCap} onClick={() => props.onAdd()}>
          <PlusIcon aria-hidden />
          Add Participant
        </Button>
        {atCap ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {`This form accepts at most ${cap} ${cap === 1 ? 'participant' : 'participants'}.`}
          </p>
        ) : null}
      </div>

      {/* Role-level problems (a minimum not met, a role over its maximum) carry no
          participant, so they belong to the list rather than to a row. */}
      {problems
        .filter((problem) => problem.participantId === undefined)
        .map((problem) => (
          <p key={problem.message} className="text-xs text-destructive">
            {problem.message}
          </p>
        ))}
    </div>
  )
}

function roleRule(min: number, max: number): string {
  if (min === 0) return `up to ${max}`
  if (min === max) return `${min} required`
  return `${min} required, up to ${max}`
}
