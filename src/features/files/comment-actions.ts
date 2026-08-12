'use server'

// Commenting on an uploaded file. CNT-05.
//
// A chair asking "can you re-export this without the speaker notes" had nowhere to say it,
// so that conversation happened in email and the next version arrived with no record of
// what had been asked or by whom.
//
// `admin`, not `reviewer`: a comment on a deliverable is an instruction to a speaker, and
// holding a reviewer role on the event is not the same as being the person who asks them
// to redo it.
//
// The file is resolved against the AUTHORIZED event through the same event-scoped roster
// the download route uses (`getEventFile`), so a file id from another conference is a
// not-found rather than a comment written onto somebody else's record.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireAdminUser, requireEventRole } from '@/features/auth/wiring'
import { getEventFile } from '@/features/files/download'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { listEventReviewers } from '@/features/review/review-reads'
import { appendFileComment } from '@/services/airtable/file-comments'
import type { RecordId } from '@/types/domain'

/** Long enough for a real instruction, short enough that it is not a document. */
const COMMENT_MAX = 2000

export async function addFileCommentAction(input: {
  eventId: RecordId
  fileId: RecordId
  body: string
}): Promise<ActionResult<{ at: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const body = input.body.trim()
    if (body === '') {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'a comment needs something in it', {
        fileId: input.fileId,
      })
    }
    if (body.length > COMMENT_MAX) {
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        `a comment is capped at ${String(COMMENT_MAX)} characters`,
        { fileId: input.fileId, length: body.length },
      )
    }

    // Throws not-found for a file outside this event. See the file header.
    const file = await getEventFile(input.eventId, input.fileId)

    const at = new Date().toISOString()
    await appendFileComment({
      eventId: input.eventId,
      fileId: file.id,
      body,
      // Snapshotted at write time, per the migration note: an organizer removed from the
      // event later must not turn their past comments anonymous.
      authorName: await authorName(input.eventId),
      at,
    })

    return actionOk({ at })
  } catch (error) {
    return actionFailure(error)
  }
}

/** The acting organizer's display name, falling back to their address, then their id. */
async function authorName(eventId: RecordId): Promise<string> {
  const { userId } = await requireAdminUser()
  const user = (await listEventReviewers(eventId)).find((candidate) => candidate.id === userId)
  if (user === undefined) return userId
  return user.name.trim() === '' ? user.email : user.name
}
