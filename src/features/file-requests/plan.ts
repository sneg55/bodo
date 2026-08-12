// What a file request assignment run would write, decided before anything is written.
//
// Nothing in this codebase created a `FileRequestAssignments` row before, so this is the
// first thing that decides one. Same tuple as tasks (`(fileRequest, speaker, submission)`,
// BUILD_SPEC 3) and therefore the same planner: `@/features/assignments/fanout` holds the
// arithmetic and this file is the FileRequests-shaped adapter over it.
//
//   - A contact- or group-scoped request produces one row per speaker, no submission.
//   - A submission-scoped request produces one row per (speaker, accepted submission), so
//     "upload your slides" against a speaker with two accepted sessions is two documents
//     owed, and delivering one of them leaves the other outstanding.
//
// Pure, and tested in tests/file-requests-plan.test.ts.

import { dedupeByTuple } from '@/features/assignments/dedupe'
import { type FanoutRow, planFanout, tupleKey } from '@/features/assignments/fanout'
import type { SpeakerScope } from '@/features/tasks/scope'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { RecordId } from '@/types/domain'
import type { FileRequest, FileRequestAssignment } from '@/types/file-requests'

export type PlannedRequestAssignment = {
  fileRequestId: RecordId
  speakerId: RecordId
  /** Set only for a submission-scoped request. */
  submissionId?: RecordId
}

/** The uniqueness tuple as one string. See `tupleKey`. */
export function requestAssignmentKey(input: {
  fileRequestId: RecordId
  speakerId: RecordId
  submissionId?: RecordId
}): string {
  return tupleKey({
    definitionId: input.fileRequestId,
    speakerId: input.speakerId,
    submissionId: input.submissionId,
  })
}

export type RequestAssignmentPlan = {
  create: readonly PlannedRequestAssignment[]
  skipped: number
}

export function planRequestAssignments(input: {
  requests: readonly FileRequest[]
  scopes: readonly SpeakerScope[]
  existing: readonly FileRequestAssignment[]
}): RequestAssignmentPlan {
  const plan = planFanout({
    definitions: input.requests,
    scopes: input.scopes,
    existing: input.existing.map((assignment) => ({
      definitionId: assignment.fileRequestId,
      speakerId: assignment.speakerId,
      submissionId: assignment.submissionId,
    })),
  })

  return { create: plan.create.map(toPlannedRow), skipped: plan.skipped }
}

/** `submissionId` omitted rather than `undefined`, as `planAssignments` explains. */
function toPlannedRow(row: FanoutRow): PlannedRequestAssignment {
  if (row.submissionId === undefined) {
    return { fileRequestId: row.definitionId, speakerId: row.speakerId }
  }
  return {
    fileRequestId: row.definitionId,
    speakerId: row.speakerId,
    submissionId: row.submissionId,
  }
}

/**
 * One entry per (request, speaker, submission) tuple, received winning.
 *
 * Exported because three surfaces read these items and each deduplicated differently before
 * this: the request card kept whichever row Airtable returned first, this table merged with
 * received-winning, and the speaker's own portal list deduplicated not at all. So a duplicate
 * row made the card read 0/1 while the table read 1/1 and the portal showed the same document
 * twice. Found by Codex review, and the identical failure had already been fixed for tasks,
 * which is why the rule now lives in `@/features/assignments/dedupe` for both.
 */
export function dedupeRequestAssignments(
  items: readonly FileRequestItem[],
): readonly FileRequestItem[] {
  return dedupeByTuple(
    items,
    (item) =>
      requestAssignmentKey({
        fileRequestId: item.request.id,
        speakerId: item.assignment.speakerId,
        submissionId: item.assignment.submissionId,
      }),
    (item) => item.assignment.status === 'received',
  )
}
