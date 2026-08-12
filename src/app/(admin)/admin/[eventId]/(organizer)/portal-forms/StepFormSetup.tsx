'use client'

// Step 1, Form Setup (ref 27).
//
// Two of the three transcribed controls are here and the third is not. `Name` and the `Type`
// cards are both stored (`Forms.name` and `Forms.entityType`). The public `Title` input next to
// Name is NOT, and it is dropped rather than wired to a column that would hold it silently:
// `Forms` has no title column, and on a portal form the heading a speaker actually reads is the
// TITLE OF THE TASK the form is assigned through, which `toTaskViews` renders and which the
// assign step takes from the form's name. A second participant-facing title would be a second
// source of truth that nothing renders. Same call `StepQuestions.tsx` made for `Section Title`
// and `Page Heading` on the CFP editor, and for the same reason.
//
// The `Type` cards are a RadioGroup per the component map: radio cards are what `RadioGroup` is
// for, and the choice is single-select and mutually exclusive.

import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { TaskEntityType } from '@/constants/status'
import type { FormDraft } from '@/features/forms/builder/draft'
import { PORTAL_FORM_NAME_MAX, PORTAL_FORM_TYPE_CARDS } from '@/features/portal-forms/form-draft'
import { cn } from '@/utils/cn'

import { TaskTypeIcon } from '../tasks/TaskTypeIcon'

export type StepFormSetupProps = {
  draft: FormDraft
  patch: (next: Partial<FormDraft>) => void
}

export function StepFormSetup({ draft, patch }: StepFormSetupProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Form Setup</h3>
        {/* Ref 27's subtitle, minus its "public title" clause, because that control is not
            here. See the header. */}
        <p className="text-sm text-muted-foreground">
          Give your form an internal name and select what kind of form you want to build.
        </p>
      </div>

      <Card className="gap-3 px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="portal-form-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {draft.name.length}/{PORTAL_FORM_NAME_MAX}
            </span>
          </div>
          <Input
            id="portal-form-name"
            value={draft.name}
            maxLength={PORTAL_FORM_NAME_MAX}
            placeholder="e.g. Speaker Contact Form"
            onChange={(event) => patch({ name: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Speakers see this as the title of the task the form is assigned through.
          </p>
        </div>
      </Card>

      <div className="flex flex-col gap-1.5">
        <Label>
          Type <span className="text-destructive">*</span>
        </Label>
        <RadioGroup
          value={draft.entityType ?? ''}
          className="grid gap-3 sm:grid-cols-3"
          onValueChange={(next: unknown) => {
            if (typeof next === 'string') patch({ entityType: next as TaskEntityType })
          }}
        >
          {PORTAL_FORM_TYPE_CARDS.map((card) => (
            <Label
              key={card.entityType}
              className={cn(
                'flex h-full cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-border p-3',
                draft.entityType === card.entityType && 'border-primary bg-muted/40',
              )}
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem value={card.entityType} />
                <TaskTypeIcon
                  entityType={card.entityType}
                  className="size-4 text-muted-foreground"
                />
                <span className="font-medium">{card.label}</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground">{card.description}</span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      {/* Inherited from the deleted Settings step, which is where this sentence used to sit.
          It is the one thing on that pane that described something real: the deadline is not
          set on the form at all, so an organizer looking for it here needs telling where it
          actually lives. See ./editor-steps.ts for why the step went. */}
      <p className="text-xs text-muted-foreground">
        A deadline is set on the task this form is assigned through, on Portals, Tasks, so one form
        can be due at different times for different groups.
      </p>
    </div>
  )
}
