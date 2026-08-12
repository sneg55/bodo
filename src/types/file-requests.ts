// FileRequests and FileRequestAssignments: "collect a document from a participant".
//
// A separate entity from Tasks rather than a task kind, which BUILD_SPEC 5.6 is explicit
// about, and the reason is in the copy ref 31 puts in its own info callout: a file
// collected against a request LIVES on the request. It is not attached to the contact,
// group or session record. So the row that says "this speaker owes this document" is not
// a TaskAssignments row with a different `kind`, it is its own table with its own
// received-at stamp.
//
// Types only, in their own file for the same reason `@/types/resources` is: the portal and
// the admin surfaces both read them, and `domain.ts` is already at the size where one more
// pair of records makes it harder to find anything.

import type { TaskEntityType } from '@/constants/status'
import type { RecordId } from '@/types/domain'

/** `pending` until a verified file lands against the row, then `received`. */
export const FILE_REQUEST_STATUSES = ['pending', 'received'] as const
export type FileRequestStatus = (typeof FILE_REQUEST_STATUSES)[number]

export type FileRequest = {
  id: RecordId
  eventId: RecordId
  title: string
  /**
   * Who the request is addressed to, in the same vocabulary Tasks uses (`contact`,
   * `group`, `submission`), because ref 30's tabs are the same four tabs ref 25 has and a
   * second vocabulary would make the two lists disagree about what "Submission" means.
   */
  entityType: TaskEntityType
  /** Ref 31's Instructions editor. HTML, because that is what the editor produces. */
  instructionsHtml?: string
  /** Whether a speaker may finish onboarding without delivering it. */
  required: boolean
  dueAt?: string
  createdAt?: string
}

export type FileRequestAssignment = {
  id: RecordId
  fileRequestId: RecordId
  speakerId: RecordId
  /**
   * Set only for a submission-scoped request, the same way a TaskAssignments row carries
   * one: a speaker with two accepted sessions owes one deck per session, and delivering
   * for one of them must not close the other.
   */
  submissionId?: RecordId
  status: FileRequestStatus
  receivedAt?: string
}
