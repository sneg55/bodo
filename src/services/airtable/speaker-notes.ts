// SpeakerNotes: the mapper, the read, and the write, in one file.
//
// Deliberately the same shape as `file-comments.ts` and `revisions.ts`, down to the file
// layout, because all three answer the same kind of question and a reader who has understood
// one should not have to learn a third arrangement for this one.
//
// It is NOT in `reads-crm.ts` / `mutations-crm.ts` for the reason those two files each carry
// in their own header: they are at their size budget, and a table whose mapper, read and
// write together are sixty lines is exactly what the one-file precedent above exists for.
// It is also not routed through `queries.ts`: that boundary exists to resolve the fixture
// branch, and there are no note fixtures to resolve, so the read is imported directly the
// same way `listFileComments` and `listRevisionsForSubmission` are.
//
// Append only, and that is the design rather than a limitation. An organizer note somebody
// can silently rewrite is not a record of what was decided: the whole value of "said no for
// 2026, ask again in spring" is that it still says that in spring.
//
// Rows are tolerant readers for the reason mapping-comms.ts gives at length: this table is
// visible in the Airtable grid, and pressing `+` there creates a blank row. A mapper that
// threw on one would turn a stray click into a 500 on the CRM profile.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { REVALIDATE, type ReadCache } from '@/services/airtable/read-cache'
import { type AirtableRecord, optionalLink, optionalText, view } from '@/services/airtable/records'
import { TABLES } from '@/services/airtable/table-names'
import { COL } from '@/services/airtable/tables'
import { speakerNotesTag } from '@/services/airtable/tags'
import { compact, link } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

export type SpeakerNote = {
  id: RecordId
  speakerId: RecordId
  body: string
  /** A name where one is known, else the address. Snapshotted, see the migration. */
  authorName: string
  at: string
}

export function mapSpeakerNote(record: AirtableRecord): SpeakerNote {
  const source = view(TABLES.speakerNotes, record)
  return {
    id: source.id,
    speakerId: optionalLink(source, COL.speaker) ?? '',
    body: optionalText(source, COL.body) ?? '',
    authorName: optionalText(source, COL.authorName) ?? 'Unknown',
    at: optionalText(source, COL.at) ?? '',
  }
}

/**
 * Tags AND a window together, per the conventions file: either alone is a bug.
 *
 * Keyed on the SPEAKER and not on an event, because the table has no event link: a note is a
 * fact about the contact and the profile that renders it is cross-event. `REVALIDATE.edited`,
 * because the organizer who just typed one expects to see it on the same screen.
 */
function notesCache(speakerId: RecordId): ReadCache {
  return { tags: [speakerNotesTag(speakerId)], revalidate: REVALIDATE.edited }
}

/**
 * One contact's internal notes, NEWEST FIRST.
 *
 * The opposite of `listFileComments` next door, and the difference is what each surface is.
 * A file thread is a conversation, so it reads forwards: the request before the answer. This
 * is a log an organizer scans for what they last decided about somebody, so it reads the way
 * the communication timeline beside it already does.
 *
 * Filtered in code rather than by formula, the rule at the top of reads.ts: an Airtable
 * formula sees a linked record as its primary field's text, so `{speaker} = 'recSpk1'`
 * matches nothing at all.
 */
export async function listSpeakerNotes(speakerId: RecordId): Promise<readonly SpeakerNote[]> {
  const records = await getClient().listAll(TABLES.speakerNotes, notesCache(speakerId))
  return records
    .map(mapSpeakerNote)
    .filter((note) => note.speakerId === speakerId)
    .sort((left, right) => right.at.localeCompare(left.at))
}

export type SpeakerNoteDraft = {
  speakerId: RecordId
  body: string
  authorName: string
  /** The caller's instant, so the action owns the clock rather than this function. */
  at: string
}

export async function appendSpeakerNote(
  draft: SpeakerNoteDraft,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().createRecords(TABLES.speakerNotes, [
    compact({
      [COL.at]: draft.at,
      [COL.speaker]: link(draft.speakerId),
      [COL.body]: draft.body,
      [COL.authorName]: draft.authorName,
    }),
  ])

  // One tag, and only this one. The Speakers row was not touched, so expiring
  // `speaker:{id}` or any event's roster here would redraw every list in the product to
  // show one new line on one card.
  invalidate(origin, { own: [speakerNotesTag(draft.speakerId)] })
}
