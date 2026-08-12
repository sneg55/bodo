// What "done" means for each of the four task kinds.
//
// BUILD_SPEC 5.6: upload (a file dropzone), form (render the linked Form with the CFP
// engine, answers into `TaskAssignments.answersJson`), link (visit and confirm),
// confirm (a checkbox). Completing sets `status=done`.
//
// Pure and unit tested, because "completing" is the one portal write that cannot be
// undone by the speaker and each kind fails differently. A `confirm` task that
// accepts an unchecked box, or an `upload` task that accepts no file, marks a speaker
// done on the organizer's dashboard with nothing behind it. That is worse than an
// error, because nobody goes looking for it.
//
// The result is the `answers` blob to store, never a bare boolean, so the record says
// what was actually confirmed rather than only that something was.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { FormAnswers } from '@/features/forms/logic'
import { sanitizeAnswers } from '@/features/forms/logic'
import { type Problem, validateAnswers } from '@/features/forms/validate'
import type { Task } from '@/types/domain'
import type { Form } from '@/types/forms'

export type TaskKind = Task['kind']

/** What the client submitted, already flattened out of FormData by the action. */
export type CompletionInput = {
  /** `upload`: the Files record id the upload route created. */
  fileId?: string
  /** `link` and `confirm`: the box the speaker ticked. */
  confirmed?: boolean
  /** `form`: answers keyed by `FormField.id`. */
  answers?: FormAnswers
}

export type CompletionResult = {
  /** Stored on the assignment as `answersJson`. */
  answers: Record<string, unknown>
  /** Field-level problems, for a `form` task. Empty means it validated. */
  problems: readonly Problem[]
}

/**
 * Build the stored evidence for one completion, or refuse.
 *
 * A `form` task returns its problems instead of throwing, matching
 * `validateAnswers`: the portal has to render each one next to the control that
 * caused it, and collapsing a filled-in form into one message loses the speaker's
 * work. The other three kinds have a single input, so there is nothing to render
 * problems against and refusing outright is the clearer answer.
 */
export function buildCompletion(input: {
  task: Pick<Task, 'id' | 'kind' | 'title'>
  form?: Form
  submitted: CompletionInput
}): CompletionResult {
  const { task, form, submitted } = input

  switch (task.kind) {
    case 'upload': {
      const fileId = submitted.fileId?.trim() ?? ''
      if (fileId === '') throw refuse(task, 'no file was uploaded')
      return { answers: { fileId }, problems: [] }
    }

    case 'link': {
      if (submitted.confirmed !== true) throw refuse(task, 'the visit was not confirmed')
      return { answers: { visitConfirmed: true }, problems: [] }
    }

    case 'confirm': {
      if (submitted.confirmed !== true) throw refuse(task, 'the confirmation box is not ticked')
      return { answers: { confirmed: true }, problems: [] }
    }

    case 'form': {
      if (form === undefined) {
        throw new AppError(
          ErrorIds.MAIL_TEMPLATE_MISSING,
          `task ${task.id} is a form task with no form linked`,
          { taskId: task.id },
        )
      }
      const answers = submitted.answers ?? {}
      const problems = validateAnswers(form.fields, answers)
      if (problems.length > 0) return { answers: {}, problems }
      // Stripped, not stored raw. A stale answer to a conditional question the
      // speaker no longer sees would otherwise be filed as an answer they gave.
      return { answers: sanitizeAnswers(form.fields, answers), problems: [] }
    }
  }
}

function refuse(task: Pick<Task, 'id' | 'title'>, why: string): AppError {
  return new AppError(ErrorIds.SUB_VALIDATION_FAIL, `cannot complete "${task.title}": ${why}`, {
    taskId: task.id,
    why,
  })
}

/** Per-kind heading for the completion control. Authored: this surface is uncaptured. */
const KIND_PROMPTS: ReadonlyMap<TaskKind, string> = new Map([
  ['upload', 'Upload a file to complete this task'],
  ['form', 'Answer these questions to complete this task'],
  ['link', 'Open the link, then confirm you have done it'],
  ['confirm', 'Confirm to complete this task'],
])

export function completionPrompt(kind: TaskKind): string {
  return KIND_PROMPTS.get(kind) ?? 'Complete this task'
}
