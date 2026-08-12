'use server'

// Assigning a portal form to the accepted speakers.
//
// Its own file rather than a fifth export of ./actions.ts, for the file-size limit and because
// it is the only write here that touches two tables: `Tasks`, to create the form-kind task that
// carries the form, and `TaskAssignments`, to fan that task out. Everything that decides is in
// ./task-plan.ts and in the two shared modules it composes, so this function reads as the
// sequence and asserts nothing itself.
//
// Nothing new is invented for the fan-out. `acceptedSpeakerScopes` is the same scope Tasks and
// File Requests assign against (being accepted is one fact, not three), and `planAssignments`
// wraps `@/features/assignments/fanout`, so pressing Assign twice is a no-op on the same tuple
// rule those two use rather than on a second implementation of it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { loadPortalFormEditor } from '@/features/portal-forms/reads'
import { planFormTask, portalFormAssignBlocker } from '@/features/portal-forms/task-plan'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { planAssignments } from '@/features/tasks/plan'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import { createTask, createTaskAssignments } from '@/services/airtable/mutations-tasks'
import {
  listSubmissions,
  listTaskAssignmentsForEvent,
  listTasksForEvent,
} from '@/services/airtable/queries'
import type { RecordId, Task } from '@/types/domain'

export type PortalFormAssignOutcome = {
  taskId: RecordId
  created: number
  skipped: number
  speakers: number
}

export async function assignPortalFormAction(input: {
  eventId: RecordId
  formId: RecordId
}): Promise<ActionResult<PortalFormAssignOutcome>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const view = await loadPortalFormEditor(input.eventId, input.formId)
    if (view === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that portal form is not on this event', {
        ...input,
      })
    }

    const blocker = portalFormAssignBlocker(view.form)
    if (blocker !== undefined) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, blocker, { formId: input.formId })
    }
    // Narrowed by the blocker above, which refuses an absent type. Re-read rather than
    // asserted, so a future change to that function cannot leave a non-null assertion behind.
    const entityType = view.form.entityType
    if (entityType === undefined) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'this form has no type yet', {
        formId: input.formId,
      })
    }

    const [defined, submissions, existing] = await Promise.all([
      listTasksForEvent(input.eventId),
      listSubmissions(input.eventId),
      listTaskAssignmentsForEvent(input.eventId),
    ])

    const task = await resolveCarrier({
      eventId: input.eventId,
      plan: planFormTask({ form: view.form, entityType, tasks: defined }),
    })

    const plan = planAssignments({
      tasks: [task],
      scopes: acceptedSpeakerScopes(submissions),
      existing: existing.map((item) => item.assignment),
    })
    const created = await createTaskAssignments({ eventId: input.eventId, rows: plan.create })

    return actionOk({
      taskId: task.id,
      created,
      skipped: plan.skipped,
      speakers: acceptedSpeakerScopes(submissions).length,
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The task that carries the form, created if it does not exist yet.
 *
 * `origin: 'manual'`, because an organizer pressed Assign. BUILD_SPEC 5.6's accept-time fan-out
 * is the `automated` side of the same column, and it is not this. No `appliesTo`, deliberately:
 * `all_accepted` marks a task for that automatic fan-out, and a form assigned by hand should not
 * silently start attaching itself to every future acceptance.
 */
async function resolveCarrier(input: {
  eventId: RecordId
  plan: ReturnType<typeof planFormTask>
}): Promise<Task> {
  if ('reuse' in input.plan) return input.plan.reuse
  return await createTask({
    eventId: input.eventId,
    title: input.plan.create.title,
    entityType: input.plan.create.entityType,
    origin: 'manual',
    kind: 'form',
    formId: input.plan.create.formId,
  })
}
