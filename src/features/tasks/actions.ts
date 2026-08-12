'use server'

// The admin half of R6: define a task, and assign it to the accepted speakers.
//
// Both authorize for themselves with `requireEventRole(eventId, 'admin')`, not because the
// layout does not redirect but because a Server Action is reachable by POST without any
// layout ever rendering (BUILD_SPEC 4). Deciding what a speaker owes is an organizer's job,
// so `reviewer` is refused: a reviewer holds a role on the event and that is not permission
// to put work on somebody's checklist.
//
// Nothing here decides anything. The scope comes from `acceptedSpeakerScopes` and the rows
// from `planAssignments`, both pure and both unit tested, so the parts that are expensive to
// debug through a form post are asserted directly.
//
// TWO ASSIGNMENT PATHS, and the second one is not a convenience. Until it existed the
// accepted cohort was the ONLY set a task could be given to, so a confirmed keynote invited
// over email, a prospect, and anybody imported from a spreadsheet were all unreachable: there
// was no control anywhere in the product that would put a task on them. `assignTasksAction`
// keeps the bulk shortcut R6 asks for; `assignTasksToSpeakersAction` takes a named list off
// the roster. They share the planner and the writer, so neither can drift from the other
// about what a row is.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { eventInstant } from '@/features/events/due-date'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { planAssignments } from '@/features/tasks/plan'
import {
  type AssignableSpeaker,
  assignableSpeakers,
  chosenSpeakerScopes,
  unreachableScopes,
} from '@/features/tasks/roster-scope'
import { acceptedSpeakerScopes, speakerDisplayName } from '@/features/tasks/scope'
import { type CreateTaskInput, isTaskDraftValid, TASK_TITLE_MAX } from '@/features/tasks/task-draft'
import { createTask, createTaskAssignments } from '@/services/airtable/mutations-tasks'
import {
  getEvent,
  listForms,
  listSpeakers,
  listSubmissions,
  listTaskAssignmentsForEvent,
  listTasksForEvent,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export async function createTaskAction(
  input: CreateTaskInput,
): Promise<ActionResult<{ taskId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Re-derived server side rather than trusted from the drawer's disabled button, which
    // is a courtesy to a person and not a check on a POST.
    const valid = isTaskDraftValid({
      title: input.title,
      description: input.description ?? '',
      entityType: input.entityType,
      kind: input.kind,
      formId: input.formId ?? '',
      dueAt: input.dueAt ?? '',
      appliesToAllAccepted: input.appliesTo === 'all_accepted',
    })
    if (!valid) {
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        `a task needs a title of up to ${TASK_TITLE_MAX} characters, and a form task needs a form`,
        { title: input.title, kind: input.kind },
      )
    }

    // A form link has to be a form on THIS event. Validation only checked that a form task
    // names one, and the id then went through unchanged, so an admin for event A could
    // attach event B's form: the portal resolves a task's form out of its own event-scoped
    // list, so the speaker would get a task with no fields and no way to complete it. Found
    // by Codex review, and the same class as the cross-event Track option in the builder.
    const event = await getEvent(input.eventId)
    if (input.formId !== undefined) {
      const forms = await listForms(input.eventId)
      const linked = forms.find((form) => form.id === input.formId)
      if (linked === undefined) {
        throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that form is not on this event', {
          eventId: input.eventId,
          formId: input.formId,
        })
      }
      // And it must be a PORTAL form. A CFP form attached to a task rendered its submission
      // questions in the portal and saved the answers into `TaskAssignments.answersJson`,
      // bypassing submission storage entirely: the speaker filled in a session proposal and
      // nothing became a Submission. Found by Codex review of the portal-forms surface.
      if (linked.kind !== 'task') {
        throw new AppError(
          ErrorIds.SUB_VALIDATION_FAIL,
          'a task can only carry a portal form, not a submission form',
          { eventId: input.eventId, formId: input.formId, kind: linked.kind },
        )
      }
    }

    // A wall-clock due date in the EVENT's zone. The control emits a zone-less
    // `datetime-local` value and the column is a UTC date-time, so passing the text through
    // stored it as UTC while `formatDue` reads it back in the event's zone: an early-morning
    // deadline came out on the previous date. Same bug and same fix as the form close date.
    const task = await createTask({
      ...input,
      dueAt: eventInstant(input.dueAt, event.timezone),
      origin: 'manual',
    })
    return actionOk({ taskId: task.id })
  } catch (error) {
    return actionFailure(error)
  }
}

export type AssignOutcome = { created: number; skipped: number; speakers: number }

/**
 * Fan the named tasks out to every accepted speaker.
 *
 * Bulk by construction rather than one speaker at a time, because that is what the R6
 * acceptance criterion asks for: "admin assigns a 3-task checklist to accepted speakers".
 * Re-running it is a no-op, since `planAssignments` skips a tuple that already has a row.
 */
export async function assignTasksAction(input: {
  eventId: RecordId
  taskIds: readonly RecordId[]
}): Promise<ActionResult<AssignOutcome>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [defined, submissions, existing] = await Promise.all([
      listTasksForEvent(input.eventId),
      listSubmissions(input.eventId),
      listTaskAssignmentsForEvent(input.eventId),
    ])

    // Filtered against the event's own tasks, so a task id from another event, or a stale
    // one from a list rendered before a delete, cannot be assigned here.
    const tasks = defined.filter((task) => input.taskIds.includes(task.id))
    if (tasks.length === 0) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no task on this event was selected', {
        eventId: input.eventId,
        requested: input.taskIds.length,
      })
    }

    const scopes = acceptedSpeakerScopes(submissions)
    const plan = planAssignments({
      tasks,
      scopes,
      existing: existing.map((item) => item.assignment),
    })

    const created = await createTaskAssignments({ eventId: input.eventId, rows: plan.create })
    return actionOk({ created, skipped: plan.skipped, speakers: scopes.length })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The event's roster, for the picker that chooses who a task goes to. SPK-09.
 *
 * An ACTION rather than a page prop, so the tasks page's payload does not carry every speaker
 * on the event for a drawer most visits never open. It is read when the picker opens.
 *
 * `admin`, matching the assignment it feeds: this hands back every speaker's name and address
 * on the event, and a reviewer neither assigns work nor needs the roster.
 */
export async function listAssignableSpeakersAction(input: {
  eventId: RecordId
}): Promise<ActionResult<{ speakers: readonly AssignableSpeaker[] }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [speakers, submissions] = await Promise.all([
      listSpeakers(input.eventId),
      listSubmissions(input.eventId),
    ])

    return actionOk({ speakers: assignableSpeakers({ speakers, submissions }) })
  } catch (error) {
    return actionFailure(error)
  }
}

export type SpeakerAssignOutcome = AssignOutcome & {
  /**
   * Chosen speakers this run wrote nothing for, by display name.
   *
   * Always empty for a contact task. It fills up when a SUBMISSION-scoped task is given to
   * somebody with no accepted session, which writes no row at all: reporting that as a plain
   * success is how a task nobody can see gets called assigned. See `unreachableScopes`.
   */
  unreachable: readonly string[]
}

/**
 * Fan the named tasks out to the speakers an organizer chose. SPK-09.
 *
 * The counterpart to `assignTasksAction`, and every rule it applies is that function's:
 * tasks are filtered against the event's own list, the planner skips a tuple that already
 * has a row, and `createTaskAssignments` expires `speaker:{id}:tasks` for each person
 * written so their portal shows the work without waiting out a cache window.
 *
 * What is new is the SPEAKER check. Ids arrive from a client, so they are resolved against
 * the authorized event's own roster and an id that is not on it fails the whole call rather
 * than being quietly dropped: silently ignoring it would let a stale drawer report success
 * for somebody who was never written, and accepting it would be a write across events.
 */
export async function assignTasksToSpeakersAction(input: {
  eventId: RecordId
  taskIds: readonly RecordId[]
  speakerIds: readonly RecordId[]
}): Promise<ActionResult<SpeakerAssignOutcome>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [defined, speakers, submissions, existing] = await Promise.all([
      listTasksForEvent(input.eventId),
      listSpeakers(input.eventId),
      listSubmissions(input.eventId),
      listTaskAssignmentsForEvent(input.eventId),
    ])

    const tasks = defined.filter((task) => input.taskIds.includes(task.id))
    if (tasks.length === 0) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'no task on this event was selected', {
        eventId: input.eventId,
        requested: input.taskIds.length,
      })
    }

    const { scopes, unknown } = chosenSpeakerScopes({
      speakers,
      submissions,
      speakerIds: input.speakerIds,
    })
    if (unknown.length > 0) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that speaker is not on this event', {
        eventId: input.eventId,
        speakerIds: unknown,
      })
    }
    if (scopes.length === 0) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'choose at least one speaker', {
        eventId: input.eventId,
      })
    }

    const plan = planAssignments({
      tasks,
      scopes,
      existing: existing.map((item) => item.assignment),
    })

    const created = await createTaskAssignments({ eventId: input.eventId, rows: plan.create })
    return actionOk({
      created,
      skipped: plan.skipped,
      speakers: scopes.length,
      unreachable: unreachableScopes({ tasks, scopes }).map((scope) =>
        speakerDisplayName(scope.speaker),
      ),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
