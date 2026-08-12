// Mappers for FileRequests and FileRequestAssignments.
//
// Its own file rather than an addition to mapping-portal.ts, which is at the size where the
// hook refuses another export. Same three traps that file absorbs (a link is an array, a
// blank field is an absent key, a default is only safe when being wrong about it is
// visible) and the same rule for choosing defaults.
//
// So: `entityType` falls back to `contact`, `status` falls back to `pending`, and `required`
// falls back to false. Each of those is the harmless direction. A blank `entityType` read as
// `submission` would file the request under a session it has no link to; a blank `status`
// read as `received` would tell an organizer a document arrived that never did; a blank
// `required` read as true would block onboarding on a request nobody marked mandatory.

import { TASK_ENTITY_TYPES } from '@/constants/status'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  linkIds,
  optionalLink,
  optionalText,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  FILE_REQUEST_STATUSES,
  type FileRequest,
  type FileRequestAssignment,
} from '@/types/file-requests'
import { safeStoredHtml } from '@/utils/safe-html'

export function mapFileRequest(record: AirtableRecord): FileRequest {
  const source = view(TABLES.fileRequests, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // Required: a request with no title is a row the portal would render as a blank thing
    // to upload against, and ref 31 gates its create button on the title for that reason.
    title: text(source, COL.title),
    entityType: choiceOr(source, COL.entityType, TASK_ENTITY_TYPES, 'contact'),
    // Sanitized at the read boundary, like every other stored-HTML column. A speaker reads this
    // inside their own authenticated portal, so an organizer running script in it crosses a
    // boundary even though they are trusted with their own event. See src/utils/safe-html.ts.
    instructionsHtml: safeStoredHtml(optionalText(source, COL.instructionsHtml)),
    required: checkbox(source, COL.required),
    dueAt: optionalText(source, COL.dueAt),
    createdAt: optionalText(source, COL.createdAt),
  }
}

/**
 * The same row, or `undefined` when a link it cannot do without has been emptied.
 *
 * Exactly the failure already fixed for task assignments, arriving again because this
 * surface was built from that template: `loadRequestGraph` maps every assignment in the base
 * BEFORE filtering by event, and both links are required, so ONE orphaned row anywhere
 * (delete a request or a speaker and Airtable empties the link rather than removing the row)
 * took down the admin table, every speaker's Requested Files card, and upload authorization,
 * for every event. Found by Codex review. See `mapTaskAssignmentIfIntact`.
 */
export function mapFileRequestAssignmentIfIntact(
  record: AirtableRecord,
): FileRequestAssignment | undefined {
  const source = view(TABLES.fileRequestAssignments, record)
  const orphaned =
    linkIds(source, COL.fileRequest).length === 0 || linkIds(source, COL.speaker).length === 0
  return orphaned ? undefined : mapFileRequestAssignment(record)
}

export function mapFileRequestAssignment(record: AirtableRecord): FileRequestAssignment {
  const source = view(TABLES.fileRequestAssignments, record)
  return {
    id: source.id,
    fileRequestId: requiredLink(source, COL.fileRequest),
    speakerId: requiredLink(source, COL.speaker),
    submissionId: optionalLink(source, COL.submission),
    status: choiceOr(source, COL.status, FILE_REQUEST_STATUSES, 'pending'),
    receivedAt: optionalText(source, COL.receivedAt),
  }
}
