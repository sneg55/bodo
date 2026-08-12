// The submission-body edit: title, typed columns, and `answersJson` in one write.
//
// Split from mutations.ts for the line limit, the same reason mutations-review.ts
// exists, and it keeps the same rule: the write ends in invalidate.ts, and there is no
// fixture branch, because an edit that reports success and stores nothing loses the
// version of an abstract the speaker believes is filed.

import type { ContentStatus } from '@/constants/status'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { TABLES } from '@/services/airtable/tables'
import { eventAgendaTag, eventSubmissionsTag, submissionTag } from '@/services/airtable/tags'
import {
  contentStatusFields,
  type SubmissionEdit,
  submissionEditFields,
} from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

export type SubmissionEditChange = SubmissionEdit & {
  submissionId: RecordId
  eventId: RecordId
}

/**
 * Save an edited submission.
 *
 * One write, not three, because it is one edit. A speaker who retitles a session and
 * changes its format in the same save must not be able to land half of it: the Abstracts
 * table sorts on the typed columns while the portal renders the blob, so a partial write
 * is two screens disagreeing about the same submission.
 *
 * The answers arrive ALREADY SPLIT (see `SubmissionEdit`), and section 5.2 decides WHEN
 * this may be called at all: everything while `status=draft`, body edits only while the
 * form still accepts updates, nothing once accepted or declined. That gate belongs to the
 * caller, which also has to authorize ownership first. This function is the write, not
 * the policy, and it deliberately does not re-derive either.
 */
export async function updateSubmission(
  change: SubmissionEditChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.submissions, [
    { id: change.submissionId, fields: submissionEditFields(change) },
  ])

  invalidate(origin, {
    own: [eventSubmissionsTag(change.eventId), submissionTag(change.submissionId)],
    // The agenda card shows the title and the track, so a retitled session changes a
    // screen the editor is not looking at.
    others: [eventAgendaTag(change.eventId)],
  })
}

/**
 * Set where a session's content stands.
 *
 * One column, written on its own rather than through `updateSubmission`, because those are
 * different acts: that one carries a title and an abstract an organizer typed and records a
 * revision for each, while this is a chair marking a deck read. Routing it through the edit
 * writer would put an empty revision in the history every time somebody approved something.
 *
 * Invalidates the agenda too. Content status decides what the Content tab counts as
 * outstanding, and that number is on a screen the person approving is not looking at.
 */
export async function setContentStatus(
  change: { eventId: RecordId; submissionId: RecordId; status: ContentStatus },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.submissions, [
    { id: change.submissionId, fields: contentStatusFields(change.status) },
  ])

  invalidate(origin, {
    own: [eventSubmissionsTag(change.eventId), submissionTag(change.submissionId)],
    others: [eventAgendaTag(change.eventId)],
  })
}
