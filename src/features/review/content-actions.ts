'use server'

// The organizer's edit of a submission's title and abstract, the history it leaves, and
// putting a prior version back.
//
// Its own file rather than more of ./actions.ts, which owns the Evaluation surface's two
// writes. These belong to the detail page and authorize differently: `admin` on the
// event, with no assignment check and no form close date, because an organizer editing
// their own event's content is not subject to the speaker's edit window. See
// ./content-edit.ts for why that asymmetry is deliberate rather than an oversight.
//
// The writing itself is in ./content-write.ts, shared by Save and Restore. This file is
// the endpoint layer: authorize, call it, hand back a Result.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { CONTENT_STATUSES, type ContentStatus } from '@/constants/status'
import { requireAdminUser, requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { restorePayload } from '@/features/review/content-edit'
import {
  applyContentEdit,
  type ContentWriteResult,
  contentSubject,
} from '@/features/review/content-write'
import { setContentStatus } from '@/services/airtable/mutations-content'
import { getSubmission } from '@/services/airtable/queries'
import { type ContentRevision, listRevisionsForSubmission } from '@/services/airtable/revisions'
import type { RecordId } from '@/types/domain'

export type ContentEditInput = {
  eventId: RecordId
  submissionId: RecordId
  title: string
  abstract: string
}

export async function saveSubmissionContentAction(
  input: ContentEditInput,
): Promise<ActionResult<ContentWriteResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const { userId } = await requireAdminUser()

    const subject = await contentSubject(input.eventId, input.submissionId)
    return actionOk(
      await applyContentEdit({
        eventId: input.eventId,
        editorId: userId,
        subject,
        title: input.title,
        abstract: input.abstract,
      }),
    )
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * One submission's change history, for the restore dialog.
 *
 * Read through an action rather than passed down as a prop because the dialog is a client
 * component inside the editor, and the editor's host renders the read-only history from
 * its own copy of this list. Fetching on open keeps the two from drifting after a save:
 * the panel below is a server render from before the write, and this is read after it.
 *
 * `admin`, matching the restore it exists to offer. A reviewer has no business reading who
 * edited what, and the route group already refuses them anyway.
 */
export async function listSubmissionRevisionsAction(input: {
  eventId: RecordId
  submissionId: RecordId
}): Promise<ActionResult<{ revisions: readonly ContentRevision[] }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Scoped the same way the writes are, and for the same reason: a submission id is
    // client input, so the history of another event's session must not be readable by
    // posting its id here.
    const submission = await getSubmission(input.submissionId)
    if (submission.eventId !== input.eventId) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that submission is not on this event', {
        eventId: input.eventId,
        submissionId: input.submissionId,
      })
    }

    return actionOk({ revisions: await listRevisionsForSubmission(submission.id) })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Put one history entry's Before value back. CNT-11.
 *
 * A restore is an ordinary save of the old value, not a rewind: it goes through
 * `applyContentEdit`, so it is validated like anything typed in and it APPENDS a history
 * row of its own saying who restored what and when. Nothing is deleted or amended. A
 * history that quietly loses the versions after the one you restored answers a different
 * question from the one an audit trail is asked.
 *
 * The revision is re-read here rather than trusted from the client. The values posted
 * back would otherwise be attacker-chosen text arriving through a path that writes it to
 * the record without the editor ever showing it.
 */
export async function restoreSubmissionContentAction(input: {
  eventId: RecordId
  submissionId: RecordId
  revisionId: RecordId
}): Promise<ActionResult<ContentWriteResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const { userId } = await requireAdminUser()

    const subject = await contentSubject(input.eventId, input.submissionId)
    const revision = (await listRevisionsForSubmission(subject.submission.id)).find(
      (candidate) => candidate.id === input.revisionId,
    )
    // `listRevisionsForSubmission` already filters to this submission, so a miss means the
    // entry belongs to another record or was never there. Not-found either way, so a
    // revision id cannot be probed for which submission it hangs off.
    if (revision === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that version is no longer on record', {
        submissionId: input.submissionId,
        revisionId: input.revisionId,
      })
    }

    const target = restorePayload({
      revision,
      currentTitle: subject.title,
      currentAbstract: subject.abstract,
    })

    return actionOk(
      await applyContentEdit({
        eventId: input.eventId,
        editorId: userId,
        subject,
        title: target.title,
        abstract: target.abstract,
      }),
    )
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Mark where a session's content stands. CNT-12.
 *
 * `admin`, not `reviewer`. Deciding a deck is good to go is an organizer's call, and holding
 * a reviewer role on the event is not the same as being the person who signs it off.
 *
 * The submission is resolved against the AUTHORIZED event before it is touched, which is the
 * rule every other write here follows: a submission id is client input, so without that
 * check an admin of one event could approve another event's content by posting its id.
 */
export async function setContentStatusAction(input: {
  eventId: RecordId
  submissionId: RecordId
  status: string
}): Promise<ActionResult<{ status: ContentStatus }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const status = CONTENT_STATUSES.find((known) => known === input.status)
    if (status === undefined) {
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        `"${input.status}" is not a content status`,
        {
          allowed: [...CONTENT_STATUSES],
        },
      )
    }

    const submission = await getSubmission(input.submissionId)
    if (submission.eventId !== input.eventId) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that session is not on this event', {
        eventId: input.eventId,
        submissionId: input.submissionId,
      })
    }

    await setContentStatus({ eventId: input.eventId, submissionId: submission.id, status })
    return actionOk({ status })
  } catch (error) {
    return actionFailure(error)
  }
}
