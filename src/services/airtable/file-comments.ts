// FileComments: the mapper, the read, and the write, in one file.
//
// Deliberately the same shape as `revisions.ts` next door, down to the file layout, because
// the two tables answer the same kind of question and a reader who has understood one
// should not have to learn a second arrangement for the other.
//
// Append only, and that is the design rather than a limitation. A thread an organizer can
// silently rewrite is not a record of what was asked for: the whole value of "re-export
// this without the speaker notes, 3 March" is that it still says that in April when the
// third version arrives.
//
// Rows are tolerant readers for the reason mapping-comms.ts gives: this table is visible in
// the Airtable grid, and pressing `+` there creates a blank row. A mapper that threw on one
// would turn a stray click into a 500 on the files page.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { type AirtableRecord, optionalLink, optionalText, view } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/table-names'
import { COL } from '@/services/airtable/tables'
import { eventFilesTag } from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'
import { hasAirtable } from '@/utils/env'

export type FileComment = {
  id: RecordId
  eventId: RecordId
  fileId: RecordId
  body: string
  /** A name where one is known, else the address. Denormalised, see the migration. */
  authorName: string
  at: string
}

export function mapFileComment(record: AirtableRecord): FileComment {
  const source = view(TABLES.fileComments, record)
  return {
    id: source.id,
    eventId: optionalLink(source, COL.event) ?? '',
    fileId: optionalLink(source, COL.file) ?? '',
    body: optionalText(source, COL.body) ?? '',
    authorName: optionalText(source, COL.authorName) ?? 'Unknown',
    at: optionalText(source, COL.at) ?? '',
  }
}

/**
 * Tags AND a window together, per the conventions file: either alone is a bug.
 *
 * Keyed on the EVENT rather than the file, because the files page reads every comment on
 * the event in one call to render a count per row. A per-file tag would mean one read per
 * row, which is the fan-out BUILD_SPEC 3.1 rules out.
 */
function commentsCache(eventId: RecordId): ReadCache {
  return { tags: [eventFilesTag(eventId)], revalidate: REVALIDATE.edited }
}

/**
 * Every comment on one event's files, oldest first.
 *
 * Oldest first because a thread reads forwards: the request comes before the answer to it.
 * That is the opposite of the revision history next door, which is newest first because a
 * history is scanned for what changed most recently.
 *
 * Filtered in code rather than by formula, the rule at the top of reads.ts: an Airtable
 * formula sees a linked record as its primary field's text, so a link comparison matches
 * nothing at all.
 */
export async function listFileComments(eventId: RecordId): Promise<readonly FileComment[]> {
  // The fixture branch, the same guard `reads-dashboards.ts:40` and `reads-prescreen.ts:58`
  // use. There is no comments fixture, and without this `getClient()` throws CFG_ENV_MISSING
  // on a clone with an empty `.env` — which 500s the whole files page, not just the counts.
  // A clone that cannot open Files is exactly what `.env.example` promises it can.
  if (!hasAirtable()) return []
  const records = await getClient().listAll(TABLES.fileComments, commentsCache(eventId))
  return records
    .map(mapFileComment)
    .filter((comment) => comment.eventId === eventId)
    .sort((left, right) => left.at.localeCompare(right.at))
}

export type FileCommentDraft = {
  eventId: RecordId
  fileId: RecordId
  body: string
  authorName: string
  at: string
}

export async function appendFileComment(
  draft: FileCommentDraft,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().createRecords(TABLES.fileComments, [
    compact({
      [COL.at]: draft.at,
      [COL.event]: link(draft.eventId),
      [COL.file]: link(draft.fileId),
      [COL.body]: draft.body,
      [COL.authorName]: draft.authorName,
    }),
  ])

  invalidate(origin, { own: [eventFilesTag(draft.eventId)] })
}
