// What a task assignment run would write, decided before anything is written.
//
// This is the missing half of R6: `TaskAssignments` rows only ever existed because
// scripts/seed/steps-portal.ts put them there, so an organizer could define nothing and
// assign nothing. The write itself is `createTaskAssignments` in
// src/services/airtable/mutations-tasks.ts; everything that DECIDES is here, so it can be
// asserted directly rather than through a form post.
//
// Two rules, and both come out of the uniqueness tuple in BUILD_SPEC 3, `(task, speaker,
// submission)`:
//
//   - A contact- or group-scoped task produces one row per speaker, with no submission.
//   - A submission-scoped task produces one row per (speaker, accepted submission), so a
//     speaker with three accepted sessions gets three, and completing "upload your slides"
//     for one of them does not tick off the other two.
//
// The arithmetic itself now lives in `@/features/assignments/fanout`, because
// `FileRequestAssignments` is unique on the same shape of tuple and needed the same
// planner. This file is the Tasks-shaped adapter over it: it names the columns `taskId`
// rather than `definitionId`, and it is what the action and its tests already call.

import { type FanoutRow, planFanout, tupleKey } from '@/features/assignments/fanout'
import type { SpeakerScope } from '@/features/tasks/scope'
import type { RecordId, Task, TaskAssignment } from '@/types/domain'

export type PlannedAssignment = {
  taskId: RecordId
  speakerId: RecordId
  /** Set only for a submission-scoped task. */
  submissionId?: RecordId
}

/** The uniqueness tuple as one string. See `tupleKey`. */
export function assignmentKey(input: {
  taskId: RecordId
  speakerId: RecordId
  submissionId?: RecordId
}): string {
  return tupleKey({
    definitionId: input.taskId,
    speakerId: input.speakerId,
    submissionId: input.submissionId,
  })
}

export type AssignmentPlan = {
  /** Rows to create, in a stable order: task, then speaker, then submission. */
  create: readonly PlannedAssignment[]
  /** Tuples that already had a row. Reported so the UI can say "already assigned". */
  skipped: number
}

export function planAssignments(input: {
  tasks: readonly Task[]
  scopes: readonly SpeakerScope[]
  existing: readonly TaskAssignment[]
}): AssignmentPlan {
  const plan = planFanout({
    definitions: input.tasks,
    scopes: input.scopes,
    existing: input.existing.map((assignment) => ({
      definitionId: assignment.taskId,
      speakerId: assignment.speakerId,
      submissionId: assignment.submissionId,
    })),
  })

  return { create: plan.create.map(toPlannedAssignment), skipped: plan.skipped }
}

/**
 * `submissionId` is omitted rather than set to `undefined` for a contact task, so the
 * planned row is exactly the field set `taskAssignmentFields` will send: an explicit
 * `undefined` would read as "clear this link" to a reader that only checks for the key.
 */
function toPlannedAssignment(row: FanoutRow): PlannedAssignment {
  if (row.submissionId === undefined) {
    return { taskId: row.definitionId, speakerId: row.speakerId }
  }
  return {
    taskId: row.definitionId,
    speakerId: row.speakerId,
    submissionId: row.submissionId,
  }
}
