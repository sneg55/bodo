// App input to an Airtable field set, for FileRequests and FileRequestAssignments.
//
// Same rule the other to-fields files state: a link is an ARRAY even when it holds one id,
// `null` clears a column, and an ABSENT key leaves the old value alone. Which of the last
// two each builder picks is a decision per column, and each one below says why.

import type { FieldSet } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'

export type FileRequestDraft = {
  eventId: RecordId
  title: string
  entityType: FileRequest['entityType']
  instructionsHtml?: string
  required: boolean
  dueAt?: string
  /** Stamped by the caller, so a test can pin it rather than read the clock. */
  createdAt: string
}

/**
 * A FileRequests row, as ref 31's drawer defines it.
 *
 * `compact` for the optional text columns, so an absent instruction body or due date is
 * simply not sent: this is a CREATE, there is no previous value to leave in place, and
 * sending `null` into a column that has never held one is a 422 rather than a blank.
 *
 * `required` is NOT compacted. It is a checkbox with two meaningful states, and omitting
 * `false` would leave it to Airtable's default, which is the one column on this table where
 * being wrong changes whether a speaker is allowed to finish onboarding without the file.
 */
export function fileRequestFields(draft: FileRequestDraft): FieldSet {
  return {
    [COL.required]: draft.required,
    ...compact({
      [COL.title]: draft.title,
      [COL.event]: link(draft.eventId),
      [COL.entityType]: draft.entityType,
      [COL.instructionsHtml]: draft.instructionsHtml,
      [COL.dueAt]: draft.dueAt,
      [COL.createdAt]: draft.createdAt,
    }),
  }
}

export type FileRequestAssignmentDraft = {
  fileRequestId: RecordId
  speakerId: RecordId
  /** Set only for a submission-scoped request. See `planRequestAssignments`. */
  submissionId?: RecordId
}

/**
 * One assignment, created pending.
 *
 * `status` is written explicitly rather than left to the column default, because
 * `mapFileRequestAssignment` reads a blank one as `pending` and a row that RELIED on that
 * would be indistinguishable from a row whose status somebody cleared by hand. `receivedAt`
 * is absent, not `null`: nothing has arrived yet, so there is no stale stamp to clear.
 */
export function fileRequestAssignmentFields(draft: FileRequestAssignmentDraft): FieldSet {
  return compact({
    [COL.fileRequest]: link(draft.fileRequestId),
    [COL.speaker]: link(draft.speakerId),
    [COL.submission]: draft.submissionId === undefined ? undefined : link(draft.submissionId),
    [COL.status]: 'pending',
  })
}

/**
 * The row moving to received.
 *
 * Both columns always carry a value, and `receivedAt` carries `null` when the row is being
 * reopened, because an omitted key would leave a pending row still claiming a document
 * arrived on Tuesday and the admin's delivered count would disagree with the portal.
 */
export function fileRequestReceiptFields(receivedAt: string | undefined): FieldSet {
  return {
    [COL.status]: receivedAt === undefined ? 'pending' : 'received',
    [COL.receivedAt]: receivedAt ?? null,
  }
}
