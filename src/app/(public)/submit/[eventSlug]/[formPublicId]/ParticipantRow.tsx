'use client'

// One person on the submission.
//
// Name and email are typed inputs rather than dynamic questions, because Speakers is
// keyed on email: a participant without one cannot be created at all, and the
// confirmation email needs a name to address. The form's own participant questions
// render under them, minus the ones that ask for the same three values, so nobody is
// asked for their email twice. `identityFieldIds` owns that decision and explains why
// it is safe to resolve by label when a registry key is missing.

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import { FieldControl } from '@/features/forms/FieldControl'
import { answerIndex, visibleFields } from '@/features/forms/logic'
import type { Problem } from '@/features/forms/validate'
import { identityFieldIds } from '@/features/submissions/participants'
import type { PublicForm } from '@/features/submissions/public-form'
import { participantAnswers } from '@/features/submissions/wizard-gating'
import type { WizardParticipant } from '@/features/submissions/wizard-state'

import { CombinedCounter } from './CombinedCounter'
import { problemsByField } from './ProblemList'

const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export type ParticipantRowProps = {
  form: PublicForm
  participant: WizardParticipant
  index: number
  problems: readonly Problem[]
  removable: boolean
  onPatch: (patch: Partial<Omit<WizardParticipant, 'key'>>) => void
  onAnswer: (fieldId: string, value: unknown) => void
  onPrimary: () => void
  onRemove: () => void
}

export function ParticipantRow(props: ParticipantRowProps) {
  const { form, participant, index, problems, removable } = props
  const identity = identityFieldIds(form.participantFields)
  const hidden = new Set(identity.values())
  const answers = participantAnswers(form, participant)
  const fields = visibleFields(form.participantFields, answers).filter(
    (field) => !hidden.has(field.id),
  )
  const values = answerIndex(answers)
  const byField = problemsByField(problems)
  const unattributed = problems.filter((problem) => problem.fieldId === undefined)

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{`Participant ${index + 1}`}</span>
        <div className="flex items-center gap-3">
          <Label className="font-normal">
            <Checkbox
              checked={participant.isPrimary}
              // Unchecking is meaningless: exactly one participant is primary, so the
              // way to change it is to check someone else.
              disabled={participant.isPrimary}
              onCheckedChange={() => props.onPrimary()}
            />
            Primary
          </Label>
          {removable ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onRemove()}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${participant.key}-first`}>First Name</Label>
          <Input
            id={`${participant.key}-first`}
            value={participant.firstName}
            onChange={(event) => props.onPatch({ firstName: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${participant.key}-last`}>Last Name</Label>
          <Input
            id={`${participant.key}-last`}
            value={participant.lastName}
            onChange={(event) => props.onPatch({ lastName: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${participant.key}-email`}>
            Email
            <span aria-hidden className="text-destructive">
              *
            </span>
          </Label>
          <Input
            id={`${participant.key}-email`}
            type="email"
            value={participant.email}
            onChange={(event) => props.onPatch({ email: event.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor={`${participant.key}-role`}>Role</Label>
        <Select
          // Without this the closed trigger printed the raw role, `speaker`, while the
          // Review step two clicks later printed `Speaker` for the same participant. Base
          // UI's `Select.Value` cannot resolve a label on its own; see `CommitteePanel`.
          items={Object.fromEntries(
            form.roles.map((rule) => [rule.role, ROLE_LABELS.get(rule.role) ?? rule.role]),
          )}
          value={participant.role}
          onValueChange={(next: string | null) => {
            const role = form.roles.find((rule) => rule.role === next)
            if (role !== undefined) props.onPatch({ role: role.role })
          }}
        >
          <SelectTrigger id={`${participant.key}-role`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {form.roles.map((rule) => (
              <SelectItem key={rule.role} value={rule.role}>
                {ROLE_LABELS.get(rule.role) ?? rule.role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fields.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={values.get(field.id)}
          problems={byField.get(field.id)}
          onChange={(value) => props.onAnswer(field.id, value)}
        />
      ))}

      {/* A speaker-field rule is measured inside THIS participant's answers, so the counter
          belongs in their row: one long biography must not spend the next speaker's budget.
          `participantAnswers` is what it counts, which is the same merge the server does. */}
      <CombinedCounter
        limits={form.crossFieldLimits.filter((limit) => limit.perParticipant)}
        fields={form.participantFields}
        answers={answers}
      />

      {unattributed.map((problem) => (
        <p key={problem.message} className="text-xs text-destructive">
          {problem.message}
        </p>
      ))}
    </div>
  )
}
