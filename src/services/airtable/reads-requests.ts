// Live reads for FileRequests and FileRequestAssignments, which nothing read before.
//
// Same split as reads-portal.ts: a read a PAGE renders declares its tags and its window, a
// read a MUTATION uses declares neither and is therefore uncached. The uncached side is
// load-bearing here, because the upload path decides whether a row is already received from
// what it reads, and a cached answer would let the same request be marked received twice
// with two different stamps.
//
// `FileRequestAssignments` has no event link, only `fileRequest`, `speaker` and
// `submission`. So the event scoping is the JOIN, exactly as `taskItems` scopes assignments
// by the event's tasks, and for the same reason: every key here is a link, and a link cannot
// be filtered in an Airtable formula (see formula.ts).
//
// TAG CHOICE, and it is the same non-obvious one reads-tasks.ts documents. Both reads below
// issue `GET /FileRequests` with no filter and no sort, which is byte-for-byte the same
// request, and a Data Cache entry is keyed on the request. So they SHARE one entry and its
// tags are whichever read populated it. That is safe only because `event:{id}:file-requests`
// is named by BOTH reads and expired by EVERY write, including a receipt; a private tag on
// one of them would be expired without expiring the shared entry, and a newly created
// request would keep not appearing until the window lapsed.

import { getClient } from '@/services/airtable/client'
import {
  mapFileRequest,
  mapFileRequestAssignmentIfIntact,
} from '@/services/airtable/mapping-requests'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { TABLES } from '@/services/airtable/tables'
import { eventFileRequestsTag, speakerFileRequestsTag } from '@/services/airtable/tags'
import type { FileRequest, FileRequestAssignment } from '@/types/file-requests'

/** An assignment with its request resolved, because no surface wants one without it. */
export type FileRequestItem = {
  assignment: FileRequestAssignment
  request: FileRequest
}

/**
 * Join assignments to the event's requests, keeping only the ones that belong here.
 *
 * An assignment whose request is not in `requests` is DROPPED rather than treated as a
 * missing link, for the reason `taskItems` gives: `requests` is ONE event's requests, and a
 * speaker who presents at two conferences legitimately has rows against the other one's.
 * Throwing would take a portal page down because of a document owed to a different event.
 *
 * Ordered by due date with the undated last, then by title, so the list does not reshuffle
 * between reads and the thing due next is at the top.
 */
export function fileRequestItems(
  requests: readonly FileRequest[],
  assignments: readonly FileRequestAssignment[],
  keep: (assignment: FileRequestAssignment) => boolean,
): readonly FileRequestItem[] {
  const byId = new Map(requests.map((request) => [request.id, request]))
  const items: FileRequestItem[] = []

  for (const assignment of assignments) {
    if (!keep(assignment)) continue
    const request = byId.get(assignment.fileRequestId)
    if (request === undefined) continue
    items.push({ assignment, request })
  }

  return items.sort(byDueThenTitle)
}

function byDueThenTitle(left: FileRequestItem, right: FileRequestItem): number {
  const leftDue = left.request.dueAt
  const rightDue = right.request.dueAt
  if (leftDue !== rightDue) {
    // An undated request sorts last. It has no deadline, so it is never the next thing owed.
    if (leftDue === undefined) return 1
    if (rightDue === undefined) return -1
    return leftDue.localeCompare(rightDue)
  }
  return left.request.title.localeCompare(right.request.title)
}

/** Every file request defined on one event, assigned or not. Ref 30's list. */
export async function listFileRequests(eventId: string): Promise<readonly FileRequest[]> {
  return await listByEvent(TABLES.fileRequests, eventId, mapFileRequest, {
    cache: requestsCache(eventId),
  })
}

function requestsCache(eventId: string): ReadCache {
  return { tags: [eventFileRequestsTag(eventId)], revalidate: REVALIDATE.edited }
}

async function loadRequestGraph(
  eventId: string,
  cache: ReadCache,
  keep: (assignment: FileRequestAssignment) => boolean,
): Promise<readonly FileRequestItem[]> {
  // Two list calls rather than a per-assignment request lookup: fanning out per row is
  // exactly what BUILD_SPEC 3.1 says will hit the rate cap.
  const [requests, assignmentRecords] = await Promise.all([
    listByEvent(TABLES.fileRequests, eventId, mapFileRequest, { cache }),
    getClient().listAll(TABLES.fileRequestAssignments, cache),
  ])
  // Orphans are skipped rather than thrown on: see `mapFileRequestAssignmentIfIntact`. One
  // row whose request or speaker had been deleted used to fail this read for every event.
  const assignments = assignmentRecords
    .map(mapFileRequestAssignmentIfIntact)
    .filter((row): row is FileRequestAssignment => row !== undefined)
  return fileRequestItems(requests, assignments, keep)
}

/** The admin side: every assignment on the event, with its request resolved. */
export async function listFileRequestAssignmentsForEvent(
  eventId: string,
): Promise<readonly FileRequestItem[]> {
  return await loadRequestGraph(eventId, requestsCache(eventId), () => true)
}

/** One speaker's own requested documents, for the portal. */
export async function listFileRequestAssignmentsForSpeaker(
  eventId: string,
  speakerId: string,
): Promise<readonly FileRequestItem[]> {
  return await loadRequestGraph(
    eventId,
    {
      tags: [speakerFileRequestsTag(speakerId), eventFileRequestsTag(eventId)],
      revalidate: REVALIDATE.edited,
    },
    (assignment) => assignment.speakerId === speakerId,
  )
}

/**
 * The same speaker graph, UNCACHED, for the upload path.
 *
 * The route decides which assignment an upload satisfies and whether it is already
 * received, and both decisions turn into a write. A cached answer there would mark a row
 * received off a snapshot taken before somebody else's upload landed, so this read exists
 * separately rather than the route reusing the page read.
 */
export async function listFileRequestAssignmentsUncached(
  eventId: string,
  speakerId: string,
): Promise<readonly FileRequestItem[]> {
  return await loadRequestGraph(eventId, {}, (assignment) => assignment.speakerId === speakerId)
}
