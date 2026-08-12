// The DAL's implementation of the portal's data port.
//
// `src/features/portal/ports.ts` declares the three functions the portal needs and
// takes them as a port, so the feature could be written and unit tested before this
// directory had a TaskAssignments or Files reader. That indirection has to be resolved
// exactly once, and the resolution lives HERE rather than in the feature, for the same
// reason `src/features/auth/wiring.ts` exists on the other side of its seam: the port is
// a shape, and only this directory is allowed to know that the shape is filled by
// Airtable.
//
// The reads go through queries.ts and not reads-portal.ts. That is the rule for anything
// a page renders: queries.ts is where the fixture branch is resolved, and the reads
// behind it are the tagged ones, so one cached request serves every visitor to that
// speaker's task list instead of one round trip per navigation.
//
// The write does not go through a fixture. With no base configured `getClient()` raises
// CFG_ENV_MISSING and the completion fails loudly, which is the same posture every other
// mutation here takes and the same guarantee the port's own refusing default was built
// to give: a task a speaker ticked off must never report success and store nothing.

import type { PortalDataPort } from '@/features/portal/ports'
import { saveTaskAnswers, setTaskAssignmentStatus } from '@/services/airtable/mutations-portal'
import { listFilesForSubmission, listTaskAssignmentsForSpeaker } from '@/services/airtable/queries'

export const airtablePortalDataPort: PortalDataPort = {
  listTaskAssignments: async ({ eventId, speakerId, fresh }) =>
    await listTaskAssignmentsForSpeaker(eventId, speakerId, fresh),

  listSubmissionFiles: async ({ submissionId }) => await listFilesForSubmission(submissionId),

  completeTaskAssignment: async (completion) => {
    await setTaskAssignmentStatus({
      assignmentId: completion.assignmentId,
      status: 'done',
      completedAt: completion.completedAt,
      // Already validated per kind by `@/features/portal/task-completion`, and empty for
      // the kinds that collect no evidence.
      answers: completion.answers,
    })
  },

  // `saveTaskAnswers` writes `answersJson` and nothing else (`taskAnswersFields`), so a save
  // cannot move a task's status in either direction. It expires the same three tags a completion
  // does, so the organizer's board and the speaker's own list both see the stored answers.
  saveTaskAnswers: async ({ assignmentId, answers }) => {
    await saveTaskAnswers({ assignmentId, answers })
  },
}
