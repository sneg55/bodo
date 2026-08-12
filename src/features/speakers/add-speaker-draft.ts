// What an Add Speaker submission is allowed to write, and what it must leave alone.
//
// Add Speaker UPSERTS BY EMAIL, so submitting an address already on the roster edits that
// person's record. That is the right behaviour (a returning speaker is one record, not two)
// and it is also the sharpest edge in this feature, because a create form's defaults are not
// an organizer's opinion about an existing row:
//
//   - `speakerFields` reads `''` as a request to CLEAR a column and drops an `undefined`
//     without writing it (services/airtable/to-fields.ts). So an untouched Company box sent
//     as `''` deletes the company the record already had.
//   - The Status select has to show something, and it shows `Prospect`. Sent unconditionally,
//     that DEMOTES a Confirmed speaker to Prospect on the way past, which is a change nobody
//     asked for and which the roster's Confirmed count then reports as a person lost.
//
// Both were real: an eval run re-added two confirmed speakers by hand and watched the
// CONFIRMED tab drop from 4 to 3 to 2 with no warning anywhere.
//
// THE RULE IS THE SAME FOR EVERY FIELD: a box the organizer did not fill in is ABSENT, never
// empty. `omitEmpty` is what says so, and `status` gets the same treatment through
// `resolveAddStatus`: chosen deliberately means write it, left at the default means leave the
// record's own value alone. A record that does not exist yet has no value to leave alone, so
// there and only there the default becomes `prospect`.
//
// Pure, total apart from the two validations it owns, and tested in
// tests/speakers-add-draft.test.ts. It sits outside `actions.ts` because that file is
// `'use server'`, where every export is a POST endpoint.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { SPEAKER_STATUSES, type SpeakerStatus } from '@/constants/status'
import { splitFullName } from '@/features/speakers/csv-parse'
import { omitEmpty } from '@/features/speakers/editable-speaker'

/** The Biography cap the portal's own editor enforces, applied on every write path. */
export const BIO_MAX_LENGTH = 5000

/** What the Add Speaker sheet posts. Everything past the address is optional by design. */
export type AddSpeakerInput = {
  email: string
  name: string
  company?: string
  /** Client input, checked against the closed vocabulary. Absent means "not chosen". */
  status?: string
  tagline?: string
  /** HTML, converted from the sheet's textarea by `textToBioHtml`. */
  bio?: string
}

/** The columns the upsert may touch. Every optional one absent means "leave it alone". */
export type AddSpeakerDraft = {
  email: string
  firstName?: string
  lastName?: string
  company?: string
  tagline?: string
  bio?: string
  status?: SpeakerStatus
}

/** The one normalization. Identical to the importer's and to `loadSpeakersByEmail`'s. */
export function normalizeSpeakerEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Deliberately loose, matching the importer: the address is checked for shape so a name in
 * the wrong box is caught, and anything past that is the mail provider's job to reject.
 */
export function assertSpeakerEmail(raw: string): string {
  const email = normalizeSpeakerEmail(raw)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `"${raw}" is not an email address`)
  }
  return email
}

/**
 * `SPEAKER_STATUSES` is the closed list; anything else is refused, not coerced.
 *
 * The same rule the team writes apply to a role, and for the same reason: an unrecognised
 * value written into a single-select column is a 422 that rejects the whole record, and a
 * value that somehow landed would be a status no surface can render or filter on.
 */
export function assertSpeakerStatus(value: string, subject: string): SpeakerStatus {
  const status = SPEAKER_STATUSES.find((known) => known === value)
  if (status === undefined) {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `"${value}" is not a speaker status`, {
      subject,
      allowed: [...SPEAKER_STATUSES],
    })
  }
  return status
}

/**
 * The draft one Add Speaker submission becomes.
 *
 * `exists` is the answer to "is this address already a speaker record", read uncached by the
 * action immediately before this is called. It changes exactly one thing, and it is the thing
 * that makes the form safe to point at a returning speaker: on a record that already exists,
 * an untouched field is left alone rather than defaulted over the top of it.
 *
 * The two name halves go through `omitEmpty` for the same reason Company does. A blank Name
 * box on a returning speaker must not erase the name they already have, and a single-word
 * name must not erase their surname; clearing a name is what the edit sheet is for.
 */
export function buildAddSpeakerDraft(
  input: AddSpeakerInput,
  options: { exists: boolean },
): AddSpeakerDraft {
  const email = assertSpeakerEmail(input.email)

  const bio = omitEmpty(input.bio)
  if (bio !== undefined && bio.length > BIO_MAX_LENGTH) {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `Biography is capped at ${String(BIO_MAX_LENGTH)} characters`,
      { length: bio.length },
    )
  }

  const { firstName, lastName } = splitFullName(input.name)
  return {
    email,
    firstName: omitEmpty(firstName),
    lastName: omitEmpty(lastName),
    company: omitEmpty(input.company),
    tagline: omitEmpty(input.tagline),
    bio,
    status: resolveAddStatus(input.status, options.exists, email),
  }
}

/**
 * The status this submission writes, or nothing.
 *
 * Nothing is the interesting answer: the select on the sheet always has a value, so "the
 * organizer did not choose one" can only be expressed by the sheet omitting the field, and
 * that is exactly what it does until somebody opens the menu. Writing the default anyway is
 * how a Confirmed speaker was silently demoted to Prospect by being re-added.
 */
function resolveAddStatus(
  value: string | undefined,
  exists: boolean,
  email: string,
): SpeakerStatus | undefined {
  const chosen = omitEmpty(value)
  if (chosen !== undefined) return assertSpeakerStatus(chosen, email)
  // A row that does not exist yet has no stored status to preserve, and every surface that
  // groups on the column reads an absent one as `prospect` anyway; writing it makes the
  // roster's tab counts add up on the first read rather than by inference.
  return exists ? undefined : 'prospect'
}
