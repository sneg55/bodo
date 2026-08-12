// The two writes R6 was missing: defining a task, and assigning it.
//
// Nothing in this codebase created a `Tasks` row or a `TaskAssignments` row before. Both
// tables existed only because scripts/seed/steps-portal.ts put rows in them, so an
// organizer could define no task, assign no task, and see nobody's progress. The speaker
// half already worked, which is what made the gap easy to miss: the portal rendered and
// completed the seeded checklist perfectly.
//
// Same posture as mutations-portal.ts: no fixture branch, and `getClient()` throws
// CFG_ENV_MISSING with no base configured. A checklist an organizer believes they assigned
// is worse than a write that fails, because the speakers never hear about it and the
// progress table will read 0/0 forever.
//
// INVALIDATION, which is the half of this that is easy to get wrong:
//
//   - Creating a task expires `event:{id}:tasks` only. That is the tag both task reads
//     subscribe to (reads-tasks.ts explains why they share it), and it is deliberately NOT
//     `event:{id}:submissions` or `event:{id}:speakers`: defining a to-do changes no
//     submission and no speaker, and expiring those would refresh the abstracts table, the
//     agenda board and the public agenda to show a change none of them render.
//   - Assigning expires `event:{id}:tasks` plus `speaker:{id}:tasks` for each speaker who
//     got a row and `submission:{id}` for each submission scoped. Per speaker rather than
//     one event-wide sweep, because a portal is cached per speaker and the point of the
//     per-speaker tag is that one person's checklist changing does not expire everybody's.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapTask } from '@/services/airtable/mapping-portal'
import { TABLES } from '@/services/airtable/tables'
import { eventTasksTag, speakerTasksTag, submissionTag } from '@/services/airtable/tags'
import {
  type TaskAssignmentDraft,
  type TaskDraft,
  taskAssignmentFields,
  taskFields,
} from '@/services/airtable/to-fields-portal'
import type { RecordId, Task } from '@/types/domain'

export async function createTask(draft: TaskDraft, origin: WriteOrigin = 'action'): Promise<Task> {
  const created = await getClient().createRecords(TABLES.tasks, [taskFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Tasks: write returned no record', {
      table: TABLES.tasks,
      title: draft.title,
    })
  }

  invalidate(origin, { own: [eventTasksTag(draft.eventId)] })
  // Mapped back rather than echoed, so the caller sees what Airtable actually stored: a
  // select column that rejected a value silently would otherwise be reported as accepted.
  return mapTask(record)
}

export type AssignmentWrite = {
  eventId: RecordId
  /** Already deduplicated against what exists. See `planAssignments`. */
  rows: readonly TaskAssignmentDraft[]
}

/**
 * Create one `TaskAssignments` row per planned tuple.
 *
 * Batched by the client at 10 per request (section 3.1), which is why this takes the whole
 * set rather than being called in a loop: a three-task checklist across a dozen accepted
 * speakers is fifty rows, and fifty single-record requests is the rate-cap fan-out the DAL
 * exists to avoid.
 *
 * An empty set writes nothing AND invalidates nothing, deliberately. Pressing Assign when
 * every row already exists is a no-op, and expiring the event's tags for it would refresh
 * every open portal to show no change.
 */
export async function createTaskAssignments(
  input: AssignmentWrite,
  origin: WriteOrigin = 'action',
): Promise<number> {
  if (input.rows.length === 0) return 0

  await getClient().createRecords(TABLES.taskAssignments, input.rows.map(taskAssignmentFields))

  const tags = new Set<string>([eventTasksTag(input.eventId)])
  for (const row of input.rows) {
    tags.add(speakerTasksTag(row.speakerId))
    // The portal's submission detail page lists that submission's tasks, so a
    // submission-scoped row is a third view of what just changed. Same three tags
    // `assignmentTags` in mutations-portal.ts names for a completion, from the other end.
    if (row.submissionId !== undefined) tags.add(submissionTag(row.submissionId))
  }

  invalidate(origin, { own: [...tags] })
  return input.rows.length
}
