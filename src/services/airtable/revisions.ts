// ContentRevisions: the mapper, the read, and the write, in one file.
//
// One file rather than the usual mapping-/reads-/to-fields- trio because the table is
// seven columns with no branches. Splitting it three ways would put fifteen lines in each
// and make the one thing worth understanding, that a revision is APPEND ONLY, harder to
// see than it is here.
//
// Append only is the whole design. Nothing updates or deletes a revision row: a history
// somebody can edit answers a different question from the one it is asked. That is also
// why the writer takes a pre-computed change list rather than two versions of a record
// and diffing them itself. `prepareContentEdit` already decided what changed, and a
// second implementation of "what is different" would eventually disagree with the first.
//
// Rows are tolerant readers, for the reason mapping-comms.ts gives at length: this table
// is visible in the Airtable grid, and pressing `+` there creates a blank row. A mapper
// that threw on one would turn a stray click into a 500 on the detail page.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { type AirtableRecord, optionalLink, optionalText, view } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/table-names'
import { COL } from '@/services/airtable/tables'
import { submissionRevisionsTag } from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

export type ContentRevision = {
  id: RecordId
  eventId: RecordId
  submissionId: RecordId
  /** The label a person reads: "Title", "Abstract". Never a column name. */
  fieldLabel: string
  previousValue: string
  newValue: string
  /** A name where one is known, else the address. Denormalised, see the migration. */
  editorName: string
  at: string
}

export function mapContentRevision(record: AirtableRecord): ContentRevision {
  const source = view(TABLES.contentRevisions, record)
  return {
    id: source.id,
    eventId: optionalLink(source, COL.event) ?? '',
    submissionId: optionalLink(source, COL.submission) ?? '',
    fieldLabel: optionalText(source, COL.fieldLabel) ?? '',
    // An edit that CLEARED a field stores the empty string, and that is a fact worth
    // keeping rather than a missing value: "Abstract: 400 words to nothing" is exactly
    // the change an organizer wants to find.
    previousValue: optionalText(source, COL.previousValue) ?? '',
    newValue: optionalText(source, COL.newValue) ?? '',
    editorName: optionalText(source, COL.editorName) ?? 'Unknown',
    at: optionalText(source, COL.at) ?? '',
  }
}

function revisionCache(submissionId: RecordId): ReadCache {
  // Tags AND a window together, per the conventions file: either alone is a bug. The
  // window is the short one, because this is read straight after the write that appends
  // to it, on the same page.
  return { tags: [submissionRevisionsTag(submissionId)], revalidate: REVALIDATE.edited }
}

/**
 * One submission's history, newest first.
 *
 * Filtered in code rather than by formula, the rule at the top of reads.ts: an Airtable
 * formula sees a linked record as its primary field's text, so `{submission} = 'recABC'`
 * matches nothing at all.
 */
export async function listRevisionsForSubmission(
  submissionId: RecordId,
): Promise<readonly ContentRevision[]> {
  const records = await getClient().listAll(TABLES.contentRevisions, revisionCache(submissionId))
  return records
    .map(mapContentRevision)
    .filter((revision) => revision.submissionId === submissionId)
    .sort((left, right) => right.at.localeCompare(left.at))
}

export type RevisionDraft = {
  eventId: RecordId
  submissionId: RecordId
  fieldLabel: string
  previousValue: string
  newValue: string
  editorName: string
  /** The caller's single instant, so every row of one save shares a timestamp. */
  at: string
}

/**
 * Append a save's worth of revisions.
 *
 * Takes the whole list and writes it in one call, because `createRecords` batches at
 * Airtable's ten-record ceiling for us and a save that changed the title and the abstract
 * must not be able to land half a history.
 *
 * A no-op for an empty list, which is the ordinary case: an organizer who opens the
 * editor and presses Save without typing anything should not leave a trail saying they
 * changed something.
 */
export async function appendRevisions(
  drafts: readonly RevisionDraft[],
  origin: WriteOrigin = 'action',
): Promise<void> {
  if (drafts.length === 0) return

  await getClient().createRecords(
    TABLES.contentRevisions,
    drafts.map((draft) =>
      compact({
        [COL.event]: link(draft.eventId),
        [COL.submission]: link(draft.submissionId),
        [COL.fieldLabel]: draft.fieldLabel,
        [COL.previousValue]: draft.previousValue,
        [COL.newValue]: draft.newValue,
        [COL.editorName]: draft.editorName,
        [COL.at]: draft.at,
      }),
    ),
  )

  invalidate(origin, { own: [submissionRevisionsTag(drafts[0].submissionId)] })
}
