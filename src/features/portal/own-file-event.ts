// Which event one of the speaker's own files belongs to.
//
// A `Files` row records a speaker and never an event (own-file.ts opens with that fact), so
// this is a question the record cannot answer on its own. It did not need answering while
// the portal served one configured event. It does now: a speaker at two conferences uploads
// against both, and a write that has to name an event (a comment on the file) has to name
// the right one, or the organizer who asked for the change never sees the reply.
//
// The answer is derived from what DOES carry an event, in the order that makes it a fact
// rather than a guess:
//
//   1. The submission the file is attached to, resolved out of the speaker's own
//      submissions, so a file on somebody else's session can never place a write.
//   2. The file request assignment it delivered, resolved out of the requests addressed to
//      this speaker, whose `FileRequest` carries the event.
//   3. Otherwise the first event in the speaker's scope, which is the whole scope when there
//      is only one, and is what every headshot upload already resolves to.
//
// Every branch stays INSIDE `eventIds`, which is the authorization boundary
// (`portalEventIds`): nothing here can return an event the speaker is not in.
//
// The single-event case, which is the ordinary one, short-circuits before any read.

import { ownSubmissions } from '@/features/portal/own-submissions'
import {
  listFileRequestAssignmentsForSpeaker,
  listSubmissionsForEvents,
} from '@/services/airtable/queries'
import type { RecordId, StoredFile } from '@/types/domain'

export type OwnFileEventInput = {
  speakerId: RecordId
  /** The speaker's event scope, from `portalEventIds`. Never empty. */
  eventIds: readonly RecordId[]
  file: StoredFile
}

export async function ownFileEventId(input: OwnFileEventInput): Promise<RecordId | undefined> {
  const fallback = input.eventIds[0]
  if (input.eventIds.length <= 1) return fallback

  return (await eventBySubmission(input)) ?? (await eventByFileRequest(input)) ?? fallback
}

async function eventBySubmission(input: OwnFileEventInput): Promise<RecordId | undefined> {
  const { submissionId } = input.file
  if (submissionId === undefined) return undefined

  // The speaker's OWN submissions, not the raw list: the event is being read off a record to
  // place a write, so the record has to be one they are on.
  const own = ownSubmissions(await listSubmissionsForEvents(input.eventIds), input.speakerId)
  return own.find((row) => row.id === submissionId)?.eventId
}

async function eventByFileRequest(input: OwnFileEventInput): Promise<RecordId | undefined> {
  const assignmentId = input.file.fileRequestAssignmentId
  if (assignmentId === undefined) return undefined

  // One read per event, as `readOwnRequestedFiles` does it and for the same reason: the read
  // is tagged `event:{id}:file-requests` and has no cross-event form, so N tagged reads is
  // the only shape that keeps a tag able to invalidate it.
  const perEvent = await Promise.all(
    input.eventIds.map(async (eventId) => ({
      eventId,
      items: await listFileRequestAssignmentsForSpeaker(eventId, input.speakerId),
    })),
  )

  return perEvent.find(({ items }) => items.some((item) => item.assignment.id === assignmentId))
    ?.eventId
}
