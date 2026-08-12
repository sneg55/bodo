// The portal-side half of the read surface: tasks, file requests, files, email bodies.
//
// Split out of queries.ts when that file passed the size budget, and `./queries.ts`
// re-exports every function here, so the import boundary is unchanged: nothing outside this
// directory imports this module by name, and nothing had to be touched to create it.
//
// Same contract as its other half. These are pass-throughs over `getSource()`, which
// answers "is there an Airtable base" exactly once; the tags and the windows live down in
// the reads, next to the table and the event they belong to.

import type { TaskAssignmentItem } from '@/services/airtable/reads-portal'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import { getSource } from '@/services/airtable/source'
import type { EmailTemplate, StoredFile, Task } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'

/**
 * One speaker's task list, for the portal's Tasks card and its tasks page. Tagged with
 * both the speaker and the event: see `listTaskAssignmentsForSpeaker` in reads-portal.ts.
 */
export async function listTaskAssignmentsForSpeaker(
  eventId: string,
  speakerId: string,
  fresh?: boolean,
): Promise<readonly TaskAssignmentItem[]> {
  return await getSource().listTaskAssignmentsForSpeaker(eventId, speakerId, fresh)
}

/** The admin Tasks board: every assignment on the event, with its task resolved. */
export async function listTaskAssignmentsForEvent(
  eventId: string,
): Promise<readonly TaskAssignmentItem[]> {
  return await getSource().listTaskAssignmentsForEvent(eventId)
}

/**
 * The tasks an organizer has defined, whether anyone is assigned or not.
 *
 * The read above cannot answer this: it resolves a task FROM an assignment, so a task
 * defined and not yet assigned is invisible through it, and that is the exact state the
 * admin Tasks list has to render.
 */
export async function listTasksForEvent(eventId: string): Promise<readonly Task[]> {
  return await getSource().listTasksForEvent(eventId)
}

/**
 * The file requests an organizer has defined, whether anyone is assigned or not. Ref 30's
 * list has to render a request that has been created and not yet fanned out, and the two
 * graph reads below resolve a request FROM an assignment, so neither can show one.
 */
export async function listFileRequests(eventId: string): Promise<readonly FileRequest[]> {
  return await getSource().listFileRequests(eventId)
}

/** The admin File Requests board: every assignment on the event, with its request. */
export async function listFileRequestAssignmentsForEvent(
  eventId: string,
): Promise<readonly FileRequestItem[]> {
  return await getSource().listFileRequestAssignmentsForEvent(eventId)
}

/** One speaker's own requested documents, for the portal card. */
export async function listFileRequestAssignmentsForSpeaker(
  eventId: string,
  speakerId: string,
): Promise<readonly FileRequestItem[]> {
  return await getSource().listFileRequestAssignmentsForSpeaker(eventId, speakerId)
}

export async function listFilesForSpeaker(speakerId: string): Promise<readonly StoredFile[]> {
  return await getSource().listFilesForSpeaker(speakerId)
}

/**
 * Files on one submission. Rows only: they carry `objectKey`, never a URL, so whether a
 * caller may see the bytes is still decided by the route that serves them (section 5.2).
 */
export async function listFilesForSubmission(submissionId: string): Promise<readonly StoredFile[]> {
  return await getSource().listFilesForSubmission(submissionId)
}

/**
 * Every file the event's speakers own, for the two admin Files lists.
 *
 * The roster is the caller's, because Files has no event link and this is the only honest
 * way to scope it. Pass the ids from `listSpeakers(eventId)`: passing a wider set would
 * widen the list past the event, which is the one thing this read cannot check for itself.
 */
export async function listFilesForEventSpeakers(
  eventId: string,
  speakerIds: readonly string[],
): Promise<readonly StoredFile[]> {
  return await getSource().listFilesForEventSpeakers(eventId, speakerIds)
}

/**
 * The event's stored email bodies. Empty on a clone with no base, where every template is
 * therefore its built-in body.
 *
 * The cached read, for the two surfaces that RENDER templates. The write path deliberately
 * does not come through here: `upsertEmailTemplate` reads uncached, so it decides what to
 * update from what is actually stored (reads-comms.ts).
 */
export async function listEmailTemplates(eventId: string): Promise<readonly EmailTemplate[]> {
  return await getSource().listEmailTemplates(eventId)
}
