// What `SpeakerEditSheet` edits, and the adaptation into it from each surface that opens it.
//
// The sheet took a `RosterSpeaker` directly while the event roster was its only caller. The
// CRM profile is the second caller and it holds a `Speaker`, which stores first and last
// name in the two columns the record actually has. Handing the sheet a display name there
// and re-splitting it would have been a regression: `firstOf` below splits on the last
// space, which gets `van der Berg` wrong, and it is only defensible on the roster because a
// joined name is the ONLY name that row has. Where both columns are already in hand, using
// them is not an optimization, it is the difference between right and wrong.
//
// Pure and client-safe on purpose. The `RosterSpeaker` import is `import type`, so it is
// erased and none of `admin-roster.ts`'s reads follow it into the client bundle.

import type { SpeakerStatus } from '@/constants/status'
import type { RosterSpeaker } from '@/features/speakers/admin-roster'
import type { RecordId, Speaker } from '@/types/domain'

/**
 * The fields an organizer owns, and deliberately not the whole profile. Pronouns, gender,
 * phone and the social links stay the speaker's own; see the header on `SpeakerEditSheet`.
 *
 * No `email`-shaped hole: it is carried and shown, never edited, because it is the identity
 * every other row links on.
 */
export type EditableSpeaker = {
  readonly id: RecordId
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly company?: string
  readonly tagline?: string
  /** Stored HTML, because the speaker writes it in TipTap. See `bio-text.ts`. */
  readonly bio?: string
  readonly headshotUrl?: string
  readonly status: SpeakerStatus
  readonly dietary?: string
  readonly travelNotes?: string
}

/**
 * The CRM profile's adaptation. Lossless: every field is already stored as the sheet edits
 * it, including the two name columns.
 *
 * `status` defaults to `prospect` for the reason the domain type records: rows written
 * before the column existed have none, and the surfaces that group on it read absent as
 * `prospect`. Opening the editor on such a row and saving it makes that reading explicit,
 * which is the same thing the roster does with the same default.
 */
export function editableFromSpeaker(speaker: Speaker): EditableSpeaker {
  return {
    id: speaker.id,
    email: speaker.email,
    firstName: speaker.firstName,
    lastName: speaker.lastName,
    company: speaker.company,
    tagline: speaker.tagline,
    bio: speaker.bio,
    headshotUrl: speaker.headshotUrl,
    status: speaker.status ?? 'prospect',
    dietary: speaker.dietary,
    travelNotes: speaker.travelNotes,
  }
}

/** The event roster's adaptation, which has to recover the two columns from a display name. */
export function editableFromRoster(speaker: RosterSpeaker): EditableSpeaker {
  return {
    id: speaker.id,
    email: speaker.email,
    firstName: firstOf(speaker),
    lastName: lastOf(speaker),
    company: speaker.company,
    tagline: speaker.tagline,
    bio: speaker.bio,
    headshotUrl: speaker.headshotUrl,
    status: speaker.status,
    dietary: speaker.dietary,
    travelNotes: speaker.travelNotes,
  }
}

/**
 * A saved edit folded back into the roster row the table is rendering.
 *
 * The row's `name` is rebuilt here rather than in the sheet, because it is the roster's own
 * display string and nothing else has one. It falls back to the email exactly as
 * `loadSpeakerRoster` does, so clearing both name fields leaves the table reading the same
 * as a fresh load rather than showing a blank cell.
 */
export function mergeIntoRoster(row: RosterSpeaker, saved: EditableSpeaker): RosterSpeaker {
  const name = `${saved.firstName.trim()} ${saved.lastName.trim()}`.trim()
  return {
    ...row,
    name: name === '' ? row.email : name,
    company: saved.company,
    tagline: saved.tagline,
    bio: saved.bio,
    headshotUrl: saved.headshotUrl,
    status: saved.status,
    dietary: saved.dietary,
    travelNotes: saved.travelNotes,
  }
}

/**
 * A field that was left blank is ABSENT rather than empty.
 *
 * The rule the ADD path needs, and it is the opposite of what the edit sheet's `blank()`
 * means by the same input. `speakerFields` reads `''` as a request to clear the column and
 * drops an `undefined` without writing it (services/airtable/to-fields.ts), so on a form that
 * was shown the stored value an empty box is an erasure, and on a form that was not it is
 * simply a field nobody filled in.
 *
 * Add Speaker is the second kind AND an upsert by email: adding an address already on the
 * roster edits that row. Without this, an organizer re-adding a returning speaker with the
 * Biography box empty would delete the bio that speaker wrote in their own portal.
 *
 * Here rather than in `actions.ts` because that file is `'use server'`, where every export
 * is a POST endpoint, and because this module is already the pure, client-safe home for what
 * the two speaker forms mean by a value.
 */
export function omitEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed
}

/**
 * The stored first and last name, recovered from a roster row.
 *
 * The row carries a display name because that is what the table shows, and it falls back to
 * the email for a speaker who has filled nothing in. Splitting on the last space is safe
 * HERE and nowhere else: it only seeds the two inputs, the organizer sees and corrects the
 * result before saving, and the save writes the two fields separately.
 */
function firstOf(speaker: RosterSpeaker): string {
  if (speaker.name === speaker.email) return ''
  return speaker.name.split(' ').slice(0, -1).join(' ') || speaker.name
}

function lastOf(speaker: RosterSpeaker): string {
  if (speaker.name === speaker.email) return ''
  const parts = speaker.name.split(' ')
  return parts.length > 1 ? (parts.at(-1) ?? '') : ''
}
