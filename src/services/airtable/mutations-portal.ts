// Writes for TaskAssignments and Files.
//
// Same posture as the rest of the write side: no fixture branch, and `getClient()`
// throws CFG_ENV_MISSING with no base configured. A task a speaker ticked off and a
// file they uploaded are both things they will never check again, so a write that goes
// nowhere and reports success is worse than one that fails.
//
// Every one of these ends in invalidate.ts, which owns what expiring a tag means.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapFile } from '@/services/airtable/mapping-portal'
import { getTask, getTaskAssignment } from '@/services/airtable/reads-portal'
import { TABLES } from '@/services/airtable/tables'
import {
  eventFilesTag,
  eventTasksTag,
  speakerFilesTag,
  speakerTasksTag,
  submissionFilesTag,
  submissionTag,
} from '@/services/airtable/tags'
import {
  type FileDraft,
  fileFields,
  type TaskAssignmentUpdate,
  taskAnswersFields,
  taskAssignmentUpdateFields,
} from '@/services/airtable/to-fields-portal'
import type { RecordId, StoredFile } from '@/types/domain'

/**
 * Which tags one assignment sits behind.
 *
 * Resolved by reading the assignment and then its task, because the portal's write
 * path knows only an assignment id: `PortalDataPort.completeTaskAssignment` is called
 * from a form post that carries the id and nothing else. Two reads to place one write
 * is the cost of that, and it is worth paying here rather than making each caller pass
 * a speaker and an event it would have to be trusted to get right, since getting it
 * wrong expires nothing and leaves the organizer's task board stale.
 *
 * Both reads are uncached (reads-portal.ts), because deciding what to invalidate from
 * a cached read can name tags for a row that has since moved.
 */
async function assignmentTags(assignmentId: RecordId): Promise<readonly string[]> {
  const assignment = await getTaskAssignment(assignmentId)
  const task = await getTask(assignment.taskId)

  const tags = [speakerTasksTag(assignment.speakerId), eventTasksTag(task.eventId)]
  if (assignment.submissionId !== undefined) {
    // The portal's submission detail page lists that submission's tasks, so it is a
    // third view of the row that just changed.
    tags.push(submissionTag(assignment.submissionId))
  }
  return tags
}

export type TaskAssignmentChange = TaskAssignmentUpdate & { assignmentId: RecordId }

/**
 * Mark one assignment done, or reopen it.
 *
 * Section 3 makes TaskAssignments unique on (task, speaker, submission), and that is
 * why this addresses a single row by id rather than by task and speaker: a speaker with
 * two accepted submissions has one row per submission for a submission-scoped task, and
 * completing "upload your slides" for one of them must not tick off the other.
 */
export async function setTaskAssignmentStatus(
  change: TaskAssignmentChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  const tags = await assignmentTags(change.assignmentId)

  await getClient().updateRecords(TABLES.taskAssignments, [
    { id: change.assignmentId, fields: taskAssignmentUpdateFields(change) },
  ])

  invalidate(origin, { own: tags })
}

/** Save a form task's answers without completing it. Section 5.6. */
export async function saveTaskAnswers(
  input: { assignmentId: RecordId; answers: Record<string, unknown> },
  origin: WriteOrigin = 'action',
): Promise<void> {
  const tags = await assignmentTags(input.assignmentId)

  await getClient().updateRecords(TABLES.taskAssignments, [
    { id: input.assignmentId, fields: taskAnswersFields(input.answers) },
  ])

  invalidate(origin, { own: tags })
}

/**
 * Record a stored object as a Files row.
 *
 * Called AFTER the upload route has put the object and HEADed it back (section 5.2), so
 * `verifiedAt` is a fact by the time it arrives here. Nothing in this function can
 * check that, which is exactly why the route does the HEAD first: a Files row is a
 * claim that bytes exist, and the only thing that can honestly make it is whoever
 * watched them land.
 *
 * `eventId` is passed and not stored. The Files table has no event link, so the admin
 * Files lists are cached under `event:{id}:files` (tags.ts) and this is the only place
 * that knows a row has just landed in that event. Omitting it leaves those two lists
 * showing yesterday's uploads until their window lapses; every other tag below is
 * derivable from the row itself, and this one is not.
 */
export async function createFileRecord(
  draft: FileDraft,
  origin: WriteOrigin = 'action',
  eventId?: string,
): Promise<StoredFile> {
  const created = await getClient().createRecords(TABLES.files, [fileFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Files: write returned no record', {
      table: TABLES.files,
      objectKey: draft.objectKey,
    })
  }

  const file = mapFile(record)
  invalidate(origin, { own: createdFileTags(file, eventId) })
  return file
}

function createdFileTags(file: StoredFile, eventId: string | undefined): readonly string[] {
  const own = [speakerFilesTag(file.speakerId)]
  if (file.submissionId !== undefined) {
    own.push(submissionFilesTag(file.submissionId), submissionTag(file.submissionId))
  }
  if (eventId !== undefined) own.push(eventFilesTag(eventId))
  return own
}
