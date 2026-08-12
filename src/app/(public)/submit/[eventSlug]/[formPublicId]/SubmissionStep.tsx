'use client'

// Step 3: the form's own questions.
//
// Visibility comes from `visibleFields` (BUILD_SPEC section 5.1), the same function the
// server re-runs on submit. There is deliberately no second evaluator here: a hidden
// question that the client thinks is visible is a required field the speaker cannot
// see, and a visible one the server thinks is hidden is an answer that gets stripped.

import { OrganizerHtml } from '@/components/primitives/OrganizerHtml'
import { FieldControl } from '@/features/forms/FieldControl'
import { answerIndex, visibleFields } from '@/features/forms/logic'
import type { Problem } from '@/features/forms/validate'
import type { PublicForm } from '@/features/submissions/public-form'
import type { WizardState } from '@/features/submissions/wizard-state'
import { CombinedCounter } from './CombinedCounter'
import { problemsByField } from './ProblemList'

export type SubmissionStepProps = {
  form: PublicForm
  state: WizardState
  problems: readonly Problem[]
  onAnswer: (fieldId: string, value: unknown) => void
}

export function SubmissionStep({ form, state, problems, onAnswer }: SubmissionStepProps) {
  const fields = visibleFields(form.fields, state.answers)
  const byField = problemsByField(problems)
  // Answers are read through a Map, never `answers[field.id]`: a dynamic index on a
  // plain object also reaches inherited keys, so a field whose id collided with a
  // prototype member would render an "answer" nobody typed.
  const answers = answerIndex(state.answers)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {/* The organizer's Section Title from the builder's step 3 ("Tell us about your
            submission"). It falls back to the form's participant-facing title, and only then
            to the internal name, so a form authored before those columns existed still shows
            a heading rather than an empty element. */}
        <h2 className="text-lg font-semibold">
          {form.abstractSectionTitle ?? form.externalTitle ?? form.name}
        </h2>
        <OrganizerHtml html={form.abstractSectionHtml} />
        <p className="text-sm text-muted-foreground">
          Questions marked with an asterisk are required.
        </p>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This form has no questions yet. Continue to add participants.
        </p>
      ) : null}

      {fields.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={answers.get(field.id)}
          problems={byField.get(field.id)}
          onChange={(value) => onAnswer(field.id, value)}
        />
      ))}

      {/* Submission-scoped rules only. A `perParticipant` one is counted inside each
          participant's row, which is the split `wizard-gating.ts` validates on. */}
      <CombinedCounter
        limits={form.crossFieldLimits.filter((limit) => !limit.perParticipant)}
        fields={form.fields}
        answers={state.answers}
      />
    </div>
  )
}
