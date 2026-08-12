// Writes for FileRequests and FileRequestAssignments: the first ones that exist.
//
// Nothing in this codebase created a row in either table before, so an organizer could not
// ask for a document and a speaker had nothing to deliver against. Same posture as the rest
// of the write side: no fixture branch, and `getClient()` throws CFG_ENV_MISSING with no
// base configured, because a request an organizer believes they created is worse than a
// write that fails loudly. Nobody re-checks a document they were told was collected.
//
// INVALIDATION, which is the half that is easy to get wrong:
//
//   - Creating a request expires `event:{id}:file-requests` only. Both file request reads
//     subscribe to it (reads-requests.ts explains why they must share it), and it is
//     deliberately NOT the tasks tag or the submissions tag: defining a request changes no
//     task and no submission, and expiring those would refresh the abstracts table and every
//     speaker's checklist to show a change neither renders.
//   - Assigning expires that tag plus `speaker:{id}:file-requests` per speaker who got a row
//     and `submission:{id}` per submission scoped, because the portal's submission detail
//     page is a third view of the same row.
//   - A receipt expires the same three, and additionally nothing else: the Files row written
//     alongside it does its own invalidation in `createFileRecord`.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapFileRequest } from '@/services/airtable/mapping-requests'
import { TABLES } from '@/services/airtable/tables'
import {
  eventFileRequestsTag,
  speakerFileRequestsTag,
  submissionTag,
} from '@/services/airtable/tags'
import {
  type FileRequestAssignmentDraft,
  type FileRequestDraft,
  fileRequestAssignmentFields,
  fileRequestFields,
  fileRequestReceiptFields,
} from '@/services/airtable/to-fields-requests'
import type { RecordId } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'

export async function createFileRequest(
  draft: FileRequestDraft,
  origin: WriteOrigin = 'action',
): Promise<FileRequest> {
  const created = await getClient().createRecords(TABLES.fileRequests, [fileRequestFields(draft)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'FileRequests: write returned no record', {
      table: TABLES.fileRequests,
      title: draft.title,
    })
  }

  invalidate(origin, { own: [eventFileRequestsTag(draft.eventId)] })
  // Mapped back rather than echoed, so the caller sees what Airtable actually stored: a
  // select column that silently rejected a value would otherwise be reported as accepted.
  return mapFileRequest(record)
}

export type RequestAssignmentWrite = {
  eventId: RecordId
  /** Already deduplicated against what exists. See `planRequestAssignments`. */
  rows: readonly FileRequestAssignmentDraft[]
}

/**
 * Create one `FileRequestAssignments` row per planned tuple.
 *
 * Batched by the client at 10 per request (BUILD_SPEC 3.1), which is why this takes the
 * whole set rather than being called in a loop.
 *
 * An empty set writes nothing AND invalidates nothing, deliberately: pressing Assign when
 * every row already exists is a no-op, and expiring the event's tag for it would refresh
 * every open portal to show no change.
 */
export async function createFileRequestAssignments(
  input: RequestAssignmentWrite,
  origin: WriteOrigin = 'action',
): Promise<number> {
  if (input.rows.length === 0) return 0

  await getClient().createRecords(
    TABLES.fileRequestAssignments,
    input.rows.map(fileRequestAssignmentFields),
  )

  const tags = new Set<string>([eventFileRequestsTag(input.eventId)])
  for (const row of input.rows) {
    tags.add(speakerFileRequestsTag(row.speakerId))
    if (row.submissionId !== undefined) tags.add(submissionTag(row.submissionId))
  }

  invalidate(origin, { own: [...tags] })
  return input.rows.length
}

export type ReceiptWrite = {
  assignmentId: RecordId
  eventId: RecordId
  speakerId: RecordId
  submissionId?: RecordId
  /** The instant the verified file landed. Absent reopens the row. */
  receivedAt?: string
}

/**
 * Mark one assignment received, or reopen it.
 *
 * Addressed by record id and never by (request, speaker), because a speaker with two
 * accepted sessions has one row per session for a submission-scoped request and delivering
 * a deck for one of them must not close the other. Which row an upload satisfies is decided
 * by `resolveRequestTarget` in @/features/file-requests/receipt, before this is called.
 *
 * The event and speaker are passed in rather than read back, unlike `assignmentTags` in
 * mutations-portal.ts: the only caller has just resolved the whole graph uncached in order
 * to find this row, so two more requests to re-derive what it is holding would be work for
 * nothing.
 */
export async function setFileRequestReceipt(
  write: ReceiptWrite,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.fileRequestAssignments, [
    { id: write.assignmentId, fields: fileRequestReceiptFields(write.receivedAt) },
  ])

  const tags = [
    eventFileRequestsTag(write.eventId),
    speakerFileRequestsTag(write.speakerId),
    ...(write.submissionId === undefined ? [] : [submissionTag(write.submissionId)]),
  ]
  invalidate(origin, { own: tags })
}
