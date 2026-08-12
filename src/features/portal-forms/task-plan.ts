// Assigning a portal form, decided before anything is written.
//
// A portal form is never assigned directly, because there is no table that could hold the
// assignment: `TaskAssignments` links a Task, not a Form. So assigning a portal form means
// creating the form-kind Task that BUILD_SPEC 5.6 and the schema already describe (`Tasks`
// carries `kind` and an optional `form` link, and `kind: 'form'` renders the linked form in the
// portal) and then fanning THAT out with the shared planner. Two steps, and only the first is
// new: `@/features/assignments/fanout` via `@/features/tasks/plan` does the arithmetic, so the
// tuple rule that stops a second click doubling a checklist is the same one tasks and file
// requests use.
//
// Everything that DECIDES is here rather than in the action, so the cases that are expensive to
// reproduce through a form post are asserted directly.
//
// Pure, and tested in tests/portal-forms-task-plan.test.ts.

import type { TaskEntityType } from '@/constants/status'
import type { RecordId, Task } from '@/types/domain'
import type { Form } from '@/types/forms'

/** Why a portal form cannot be assigned yet, or undefined when it can. */
export function portalFormAssignBlocker(form: Form): string | undefined {
  if (form.kind !== 'task') return 'that form is not a portal form'
  if (form.entityType === undefined) {
    return 'this form has no type yet, so there is nobody to assign it to. Choose Contacts or Submissions on Form Setup.'
  }
  // A form with no questions renders in the portal as a to-do with nothing to fill in, and its
  // Complete button would store an empty answer set. That is the failure mode worth refusing:
  // the speaker is marked done and the organizer collected nothing.
  if (form.fields.length === 0) {
    return 'this form has no questions yet, so there would be nothing for a speaker to fill in.'
  }
  return undefined
}

export type FormTaskDraft = {
  title: string
  entityType: TaskEntityType
  kind: 'form'
  formId: RecordId
}

export type FormTaskPlan =
  /** A task already carries this form to this audience. Reused, so re-assigning is a no-op. */
  | { reuse: Task }
  /** Nothing carries it yet. The action creates this, then fans it out. */
  | { create: FormTaskDraft }

/**
 * The task that carries one portal form, found or described.
 *
 * Matched on all three of `kind`, `form` and `entityType`. The first two are obvious; the third
 * is the case that would otherwise go wrong silently. An organizer who assigns a Contacts form,
 * then changes its Type to Submissions and assigns again, gets a SECOND task rather than having
 * the first one re-scoped: re-scoping would leave every assignment already created (and
 * possibly already completed) filed under a scope the task no longer claims, and one of them
 * would be a contact-scoped row on a task that says it hangs off a session. A second task
 * keeps both histories readable, and the organizer can see both on the Tasks list.
 */
export function planFormTask(input: {
  form: Form
  entityType: TaskEntityType
  tasks: readonly Task[]
}): FormTaskPlan {
  const existing = input.tasks.find(
    (task) =>
      task.kind === 'form' && task.formId === input.form.id && task.entityType === input.entityType,
  )
  if (existing !== undefined) return { reuse: existing }

  return {
    create: {
      // The form's internal name, because the task's title is what the speaker actually reads
      // in their portal (`toTaskViews` renders `task.title`, never the form's). A second
      // participant-facing title on the form would be a second source of truth that nothing
      // renders. See the note in the editor.
      title: input.form.name,
      entityType: input.entityType,
      kind: 'form',
      formId: input.form.id,
    },
  }
}
