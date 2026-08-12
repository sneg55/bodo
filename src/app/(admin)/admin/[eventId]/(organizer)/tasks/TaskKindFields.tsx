'use client'

// The two controls that decide HOW a task is completed: the kind picker, and the form it
// links when the kind is `form`.
//
// Split out of AddTaskSheet.tsx, which crossed the file-size limit when the speaker picker
// landed. These two belong together and nothing else in the drawer depends on them: the kind
// is what `buildCompletion` switches on, and the form select exists only for one of its four
// values, so a change to either is a change to the same question.
//
// Both `Select` quirks below are load-bearing and were found on the running app, not
// inferred. They are documented at each call rather than in one note, because each was a
// different symptom of the same Base UI default.

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TaskKind } from '@/features/portal/task-completion'
import type { TaskFormOption } from '@/features/tasks/admin-view'
import { TASK_KIND_OPTIONS } from '@/features/tasks/task-draft'

export type TaskKindFieldsProps = {
  kind: TaskKind
  /** A form's record id, or empty. Only read when `kind` is `form`. */
  formId: string
  forms: readonly TaskFormOption[]
  onKindChange: (kind: TaskKind) => void
  onFormChange: (formId: string) => void
}

export function TaskKindFields({
  kind,
  formId,
  forms,
  onKindChange,
  onFormChange,
}: TaskKindFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>How it is completed</Label>
        <Select
          value={kind}
          onValueChange={(next: TaskKind | null) => {
            if (next !== null) onKindChange(next)
          }}
        >
          <SelectTrigger className="w-full">
            {/* A render function, not a bare `<SelectValue />`. Base UI's Select.Value
                prints the raw VALUE by default, so the closed trigger read `confirm`
                rather than `Tick a checkbox`. Seen on the running app. */}
            <SelectValue>
              {(value: unknown) =>
                TASK_KIND_OPTIONS.find((option) => option.kind === value)?.label ?? ''
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TASK_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.kind} value={option.kind}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === 'form' ? (
        <div className="flex flex-col gap-1.5">
          <Label>
            Form <span className="text-destructive">*</span>
          </Label>
          <Select
            // The same bug the render function above was written for, missed on this
            // one: the value is a form's RECORD ID, so the closed trigger read
            // `recAbc123` once a form was picked. `items` rather than a second render
            // function, because the map is already to hand.
            items={Object.fromEntries(forms.map((form) => [form.id, form.name]))}
            value={formId}
            onValueChange={(next: string | null) => onFormChange(next ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a form..." />
            </SelectTrigger>
            <SelectContent>
              {forms.map((form) => (
                <SelectItem key={form.id} value={form.id}>
                  {form.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {forms.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This event has no forms yet, so a form task cannot be created.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
