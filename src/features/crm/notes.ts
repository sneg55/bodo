// Internal notes on a CRM contact, as rules: what a note may contain, and how a stored one
// renders.
//
// Pure, so `tests/crm-notes.test.ts` asserts it without a base. It exists because the
// composer on the profile and `addSpeakerNoteAction` behind it must agree about the same two
// questions, and a check that lives only in the textarea is a check anybody can POST past.
//
// ORG-LEVEL, and that is the whole distinction this file carries. `Speakers.travelNotes` is
// one organizer's logistics for one trip and lives as a column on the Speakers row, editable
// through the speaker edit sheet. A note here is a fact about the CONTACT ("said no for 2026,
// ask again in spring") that follows them to the next conference, is attributed, is stamped,
// and is never rewritten. Both are rendered on the profile, and the surface says which is
// which, because an organizer who cannot tell them apart will put the wrong thing in one.

import { dateTimeText } from '@/features/review/date-text'
import type { SpeakerNote } from '@/services/airtable/speaker-notes'
import type { RecordId } from '@/types/domain'

/**
 * A note is a paragraph, not an essay.
 *
 * 2,000 rather than the 5,000 a biography gets, matching the file-comment thread
 * (`COMMENT_MAX` in features/files/comment-actions.ts), because both are the same kind of
 * writing: a short internal remark somebody else has to read in a list of them. The cap is
 * enforced in the action as well as counted down in the composer.
 */
export const NOTE_MAX_LENGTH = 2_000

/**
 * The note that will be written, or why it will not be.
 *
 * Returns the TRIMMED body rather than only a verdict, so the caller cannot check one string
 * and write a different one. That drift is not hypothetical: a composer that trims for its
 * own length counter and posts the raw value would store leading newlines the check said
 * were not there.
 */
export function checkNoteBody(
  body: string,
): { ok: true; body: string } | { ok: false; reason: string } {
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'Write something before saving.' }
  if (trimmed.length > NOTE_MAX_LENGTH) {
    return { ok: false, reason: `A note is capped at ${String(NOTE_MAX_LENGTH)} characters.` }
  }
  return { ok: true, body: trimmed }
}

/** One note with its timestamp already rendered. See `stageHistoryRows` on why here. */
export type SpeakerNoteRow = {
  readonly id: RecordId
  readonly body: string
  readonly authorName: string
  readonly atText: string
}

/**
 * The rendered notes, in the order they were read (newest first).
 *
 * One timezone for the list, for the reason `stageHistoryRows` gives: a note belongs to the
 * person and names no event, so there is no per-row venue zone to render it in.
 */
export function speakerNoteRows(
  notes: readonly SpeakerNote[],
  timezone: string,
): readonly SpeakerNoteRow[] {
  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    authorName: note.authorName,
    atText: dateTimeText(note.at, timezone),
  }))
}
