// The two reads the portal needs and the DAL does not have yet.
//
// `src/services/airtable/queries.ts` is the whole cached read surface, and it covers
// events, submissions, forms, lookups, speakers, the review graph and memberships.
// It has no reader for TaskAssignments and none for Files, although both tables are
// declared in `tables.ts` and both types exist in `@/types/domain`. R2's portal needs
// both: BUILD_SPEC 5.2 puts the submission-scoped tasks and the attached files on the
// detail page, and 5.6 puts task completion in the portal.
//
// Rather than reach around the DAL (nothing outside `src/services/airtable` may talk
// to Airtable, and a read outside it would have no `cacheTag`, so nothing could ever
// invalidate it), the feature declares the shape it needs and takes it as a port.
// Wiring it is then one function: implement `PortalDataPort` over
// `listTaskAssignmentsForSpeaker` / `listFilesForSubmission` when those land, and
// pass it to `setPortalDataPort`.
//
// The default is not a fake. Reads answer "nothing", which is a true statement about
// a base with no TaskAssignments rows and is exactly the state refs 17-18 captured
// (both task counts read 0). Writes REFUSE: a task completion that reported success
// and stored nothing would tell a speaker they were done when the organizer's
// dashboard will never move, and that is the one failure worth an error page.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { RecordId, StoredFile, Task, TaskAssignment } from '@/types/domain'

/** An assignment with the task it points at, because no surface wants one alone. */
export type PortalTaskItem = {
  assignment: TaskAssignment
  task: Task
}

export type TaskCompletion = {
  assignmentId: RecordId
  completedAt: string
  /** Per-kind evidence, already validated by ./task-completion. */
  answers: Record<string, unknown>
}

export type PortalDataPort = {
  /** Every assignment for one speaker on one event, contact and submission scoped. */
  listTaskAssignments: (input: {
    eventId: RecordId
    speakerId: RecordId
    /**
     * Bypass the cache. Passed by the write path only: a page render may show a list a
     * minute old, but a mutation that decides OWNERSHIP from it must not.
     */
    fresh?: boolean
  }) => Promise<readonly PortalTaskItem[]>

  /** Files attached to one submission. Visibility is decided by the serving route. */
  listSubmissionFiles: (input: { submissionId: RecordId }) => Promise<readonly StoredFile[]>

  /** Sets `status=done` and stamps `completedAt`. Authorization is the caller's. */
  completeTaskAssignment: (completion: TaskCompletion) => Promise<void>

  /**
   * Stores a form task's answers WITHOUT completing it: the "save my progress" half of filling
   * in a portal form (BUILD_SPEC 5.6).
   *
   * Separate from `completeTaskAssignment` rather than a flag on it, because the two differ in
   * more than one column: this one must not touch `status` or `completedAt`, so re-saving a task
   * that is already done cannot reopen it, and a save that raced a completion cannot un-complete
   * it. Authorization is the caller's, as above.
   */
  saveTaskAnswers: (input: {
    assignmentId: RecordId
    answers: Record<string, unknown>
  }) => Promise<void>
}

const unprovisioned: PortalDataPort = {
  listTaskAssignments: () => Promise.resolve([]),
  listSubmissionFiles: () => Promise.resolve([]),
  completeTaskAssignment: (completion) =>
    Promise.reject(
      new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'no TaskAssignments writer is wired: the DAL has no task mutations yet, so this completion was not stored',
        { assignmentId: completion.assignmentId },
      ),
    ),
  // Refuses for the same reason the completion does: a speaker told their work was saved, whose
  // answers went nowhere, will retype nothing and lose everything.
  saveTaskAnswers: (input) =>
    Promise.reject(
      new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'no TaskAssignments writer is wired, so these answers were not stored',
        { assignmentId: input.assignmentId },
      ),
    ),
}

// Module-level, and that is allowed here for the same reason the DAL's source switch
// is: it is set once from configuration and never mutated per request. The rule in
// BUILD_SPEC 1 bans module state used as a CACHE, because isolates come and go.
let port: PortalDataPort = unprovisioned

export function setPortalDataPort(next: PortalDataPort): void {
  port = next
}

// The real port is installed by `@/features/portal/wiring`, which the portal routes
// import. It is deliberately NOT installed here: importing the data layer from this
// file would point a feature at a service, which is the dependency the port exists to
// avoid, and a module-level side effect would also make `unprovisioned` unobservable,
// so the tests that describe what a port must promise would have nothing to test.

export function portalDataPort(): PortalDataPort {
  return port
}

/** True while the reads above are answering "nothing" rather than answering. */
export function portalDataPortIsWired(): boolean {
  return port !== unprovisioned
}
