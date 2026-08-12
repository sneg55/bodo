'use client'

// Filling in a portal form task (BUILD_SPEC 5.6: "form (render the linked Form with the same
// engine as CFP, answers into TaskAssignments.answersJson)").
//
// The questions go through the SHARED `FieldControl`, which is the same renderer the public CFP
// wizard and the portal's submission editor use. That is the whole reason this file replaced the
// text-box-only control that used to live inside `TaskCompletion`: a dropdown rendered as a text
// input, a multiselect had no control at all, and a conditional question was shown
// unconditionally here while the server validated it conditionally, so a speaker could be
// refused for an answer to a question they were never meant to see.
//
// Two buttons, and the difference between them is the point. `Save` keeps the work and leaves the
// task open, so a required question may still be blank; `Mark complete` is the one that refuses a
// blank required question and moves the status. Both post the answers as one JSON value rather
// than as named inputs, because a multiselect answer is an array and a checkbox answer is a
// boolean and form encoding flattens both.
//
// `visibleFields` runs here on every keystroke and again on the server, which is the contract in
// BUILD_SPEC 5.1: one implementation, two places, so the form never validates a question nobody
// was shown.

// `Mark complete` asks the router for fresh server output and `Save` deliberately does not.
// Completing moves the assignment to done, and the status badge, the section counts and this
// whole control are server-rendered off that row, so without a refresh a completed form task
// keeps rendering as `Pending` with its questions still open until the speaker reloads by
// hand. A save changes no status and the speaker is still typing, so refreshing there would
// be churn under their cursor. Same split as `TaskCompletion` next door.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { OrganizerHtml } from '@/components/primitives/OrganizerHtml'
import { Button } from '@/components/ui/button'
import { FieldControl } from '@/features/forms/FieldControl'
import { answerIndex, type FormAnswers, visibleFields } from '@/features/forms/logic'
import { completeTaskAction, saveTaskAnswersAction } from '@/features/portal/actions'
import { completionPrompt } from '@/features/portal/task-completion'
import type { TaskView } from '@/features/portal/task-view'
import { useHydrated } from '@/features/portal/use-hydrated'

export function TaskFormAnswers({
  task,
  onCompleted,
}: {
  task: TaskView
  /** Told once the completion is stored, so the row can stop reading `Pending`. */
  onCompleted: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<FormAnswers>(task.answers)
  const [pending, startTransition] = useTransition()
  // Both buttons are `onClick` handlers, so a press before this component hydrates does
  // nothing at all and says nothing about it. They declare it instead. Same rule, and the
  // same reasoning, as the Save button on the profile: ./use-hydrated.ts.
  const ready = useHydrated()
  const busy = pending || !ready

  if (task.formMissing) {
    return (
      <p className="text-sm text-muted-foreground">
        The form for this task is no longer available. Your organizer has been able to see this
        task, so ask them to restore or replace it.
      </p>
    )
  }
  if (task.fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This form has no questions yet, so there is nothing to fill in.
      </p>
    )
  }

  const visible = visibleFields(task.fields, draft)
  // Read through a Map, never `draft[field.id]`: a dynamic index on a plain object also reaches
  // inherited keys, so a field whose id collided with a prototype member would render an "answer"
  // nobody typed.
  const current = answerIndex(draft)

  function post(
    action: typeof saveTaskAnswersAction,
    success: string,
    /** Completing changes the status this control is rendered from; saving does not. */
    refresh = false,
  ): void {
    const formData = new FormData()
    formData.set('assignmentId', task.assignmentId)
    formData.set('answers', JSON.stringify(draft))
    startTransition(async () => {
      const result = await action(formData)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(success, { description: result.message })
      if (!refresh) return
      // Completed: switch the row over now, then ask for the server's copy. `TaskCompletion`
      // next door explains why the two are separate steps.
      onCompleted()
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium text-muted-foreground">{completionPrompt(task.kind)}</p>

      {/* The organizer's instructions for this form, which step 2 of the portal form builder
          promises will sit above the questions. Sanitized, like every other stored-HTML sink. */}
      <OrganizerHtml html={task.instructionsHtml} />

      {visible.map((field) => (
        <FieldControl
          key={field.id}
          field={field}
          value={current.get(field.id)}
          disabled={busy}
          onChange={(value) => {
            setDraft((previous) => ({ ...previous, [field.id]: value }))
          }}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {/* 28px text buttons, already wide, so the band. Together they measure about 158px
            against a task panel that is never narrower than 234px, so the `flex-wrap` here
            puts only the sentence beside them on a second line and there is no control row
            to cross; the last question is 16px above across the column's `gap-4`. */}
        <Button
          variant="outline"
          size="sm"
          className="hit-area-y"
          disabled={busy}
          aria-busy={busy}
          onClick={() => post(saveTaskAnswersAction, 'Saved successfully')}
        >
          {buttonLabel({ pending, ready, idle: 'Save' })}
        </Button>
        <Button
          size="sm"
          className="hit-area-y"
          disabled={busy}
          aria-busy={busy}
          onClick={() => post(completeTaskAction, 'Task completed', true)}
        >
          {buttonLabel({ pending, ready, idle: 'Mark complete' })}
        </Button>
        <span className="text-xs text-muted-foreground">
          Save keeps your answers and leaves the task open.
        </span>
      </div>
    </div>
  )
}

/**
 * `Save` and `Mark complete` are the transcribed labels and they are what each button reads
 * whenever pressing it would do something. `Loading` is the only honest name for a control
 * whose handler is not attached yet.
 */
function buttonLabel(state: { pending: boolean; ready: boolean; idle: string }): string {
  if (state.pending) return 'Saving'
  return state.ready ? state.idle : 'Loading'
}
