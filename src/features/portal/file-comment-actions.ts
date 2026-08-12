'use server'

// The speaker's half of the file comment thread. CNT-05.
//
// The thread shipped organizer-side only, and its own helper text said the note lets "a
// speaker be told what to change". Nothing told them: the portal had no comment surface at
// all, so a chair asking "can you re-export this without the speaker notes" wrote it into a
// popover the person who had to act on it could not open. A one-sided thread is worse than
// no thread, because the organizer believes the message was delivered.
//
// Same table, same append-only rule. What differs is the authorization: an organizer is
// authorized against the EVENT (`requireEventRole(eventId, 'admin')`), a speaker against the
// FILE, because the only files they may discuss are the ones they uploaded.
//
// Both halves are scoped to the speaker's OWN EVENTS rather than to the configured one. A
// `Files` row records a speaker and never an event (own-file.ts says why), so reading one
// event's comments meant a speaker at two conferences saw an empty thread on a deck the
// other organizer had already written on, and a reply to it was filed against the wrong
// event, where the organizer who asked for it would never read it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import { fileCommentThreads } from '@/features/files/comment-threads'
import { assertOwnsFile, speakerSubject } from '@/features/portal/authorize'
import { portalEventIds } from '@/features/portal/event-scope'
import { displayNameOf } from '@/features/portal/identity'
import { ownFileEventId } from '@/features/portal/own-file-event'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { appendFileComment, listFileComments } from '@/services/airtable/file-comments'
import { getSpeaker, listFilesForSpeaker } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

/** The same cap the organizer's box enforces, so one side cannot outwrite the other. */
const COMMENT_MAX = 2000

export type PortalFileComment = {
  readonly id: RecordId
  readonly body: string
  readonly authorName: string
  readonly at: string
}

/**
 * The thread on one of the caller's own deliverables.
 *
 * The file is resolved out of `listFilesForSpeaker`, which is already scoped to the acting
 * speaker, and then checked again with `assertOwnsFile`. That is one check more than is
 * strictly needed and it is the one the portal rules ask for: an id arriving from the
 * browser is never the thing that decides what a read returns.
 *
 * Threaded by VERSION GROUP rather than by file id, and that is the fix for the defect this
 * surface actually had: uploading a corrected deck created a new `Files` row, so the note
 * asking for the correction vanished from the portal at the moment it was answered and this
 * card read "No comments yet". The group is computed over the speaker's OWN files only, so
 * every message merged in is one about a file `assertOwnsFile` would have allowed anyway.
 */
export async function listOwnFileCommentsAction(input: {
  fileId: RecordId
}): Promise<ActionResult<{ comments: readonly PortalFileComment[] }>> {
  try {
    const { speakerId } = await requireSpeaker()
    const eventIds = await portalEventIds(speakerId)

    const own = await listFilesForSpeaker(speakerId)
    const file = own.find((candidate) => candidate.id === input.fileId)
    if (file === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that file is not one of yours', {
        fileId: input.fileId,
      })
    }
    assertOwnsFile(speakerSubject(speakerId), file)

    // Every event the speaker is in, merged and re-sorted so the thread still reads forwards
    // across them. Widening leaks nothing: `fileCommentThreads` drops any comment whose file
    // is not in `own`, and `own` is this speaker's uploads.
    const merged = (await Promise.all(eventIds.map(async (id) => await listFileComments(id))))
      .flat()
      .sort((left, right) => left.at.localeCompare(right.at))

    const thread = fileCommentThreads(own, merged).get(file.id) ?? []
    const comments = thread.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorName: comment.authorName,
      at: comment.at,
    }))

    return actionOk({ comments })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Reply to the thread on one of the caller's own files. */
export async function addOwnFileCommentAction(input: {
  fileId: RecordId
  body: string
}): Promise<ActionResult<{ at: string }>> {
  try {
    const { speakerId } = await requireSpeaker()
    const eventIds = await portalEventIds(speakerId)

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

    const file = (await listFilesForSpeaker(speakerId)).find(
      (candidate) => candidate.id === input.fileId,
    )
    if (file === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that file is not one of yours', {
        fileId: input.fileId,
      })
    }
    assertOwnsFile(speakerSubject(speakerId), file)

    // The event this FILE belongs to, derived from the submission or the file request it
    // answers (./own-file-event.ts). Writing the configured event instead filed a reply
    // where the organizer who asked the question does not read, because their Files page
    // lists `listFileComments(theirEventId)` and drops everything else.
    const eventId = await ownFileEventId({ speakerId, eventIds, file })
    if (eventId === undefined) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that file is not on any of your events', {
        fileId: input.fileId,
      })
    }

    const at = new Date().toISOString()
    await appendFileComment({
      eventId,
      fileId: file.id,
      body,
      // Snapshotted at write time, exactly as the organizer's side does it: a speaker who
      // changes their name later must not retroactively rewrite who said what.
      authorName: displayNameOf(await getSpeaker(speakerId)),
      at,
    })

    return actionOk({ at })
  } catch (error) {
    return actionFailure(error)
  }
}
