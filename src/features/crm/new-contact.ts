// What a hand-typed CRM contact has to be before it is written.
//
// Pure and synchronous, with no `'use server'` directive, for the reason `notes.ts` and
// `commit.ts` give: a `'use server'` file may only export async functions, and this is a
// string check. `new-contact-actions.ts` is the action that calls it, and the dialog
// (`NewContactDialog.tsx`) calls it too so the Save button is disabled with a sentence
// attached rather than enabled with a refusal waiting behind it.
//
// WHY THIS EXISTS AT ALL. The CRM had no manual create path: a contact arrived from a CFP
// submission or from a CSV import and nowhere else, so an organizer who had just met one
// speaker had to write a one-row spreadsheet to get them in. The import wizard is the bulk
// path and stays the bulk path; this is the single-person one.
//
// The rules are deliberately the import's rules, not stricter ones. `email` is the identity
// every other row links on and the only required field (`IMPORTABLE_FIELDS`), an address with
// no `@` is refused with the same two words `mapRow` and `planRow` refuse it with, and every
// other field is optional because the portal collects the rest from the speaker themselves.

/** Room for a long address without letting a paste of a whole file through. RFC 5321's limit. */
export const CONTACT_EMAIL_MAX = 320

/**
 * The bound on every free-text field here.
 *
 * A hostile-payload bound rather than content validation, exactly as `commit.ts` describes
 * its own: a name longer than this was not typed by anybody, and what an organizer can
 * genuinely get wrong is caught by the checks below with a sentence they can act on.
 */
export const CONTACT_VALUE_MAX = 200

/** A contact as the dialog holds it, before anything has been checked. */
export type NewContactDraft = {
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly company: string
  readonly tagline: string
  readonly eventId: string
}

/** A contact as the write layer takes it: trimmed, and with the empty fields dropped. */
export type CheckedContact = {
  readonly email: string
  readonly firstName?: string
  readonly lastName?: string
  readonly company?: string
  readonly tagline?: string
  readonly eventId: string
}

export type ContactCheck =
  | { readonly ok: true; readonly contact: CheckedContact }
  | { readonly ok: false; readonly reason: string }

/** The empty dialog, so the component and its tests start from one declaration. */
export const EMPTY_CONTACT_DRAFT: NewContactDraft = {
  email: '',
  firstName: '',
  lastName: '',
  company: '',
  tagline: '',
  eventId: '',
}

/**
 * The contact that will be written, or why it will not be.
 *
 * It hands back the TRIMMED, narrowed record rather than a verdict, the reason `checkNoteBody`
 * gives: a caller that checks one string and writes another has already drifted, and here that
 * would store an address with a trailing space that the duplicate match would then miss.
 *
 * An empty optional field is DROPPED rather than carried through as `''`. `speakerFields` maps
 * every present key onto a column, so a blank Company on a create would write an empty cell
 * where the portal would otherwise have filled one in; it is the same rule `mapRow` applies to
 * an empty CSV cell, and for the same reason.
 *
 * The address is trimmed but NOT lowercased, matching `mapRow`: `upsertSpeakerByEmail`
 * normalizes before it matches and before it writes, so casing changes nothing downstream, and
 * what the organizer typed is what the toast echoes back at them.
 */
export function checkNewContact(draft: NewContactDraft): ContactCheck {
  const email = draft.email.trim()
  if (email === '') return { ok: false, reason: 'Missing email' }
  if (email.length > CONTACT_EMAIL_MAX) {
    return {
      ok: false,
      reason: `An email address is capped at ${String(CONTACT_EMAIL_MAX)} characters.`,
    }
  }
  // The same test `planRow` applies, and deliberately no stricter: a regex that rejects a
  // legal address an organizer is holding in their hand is worse than one that accepts a typo
  // they can correct on the profile.
  if (!email.includes('@')) return { ok: false, reason: 'Invalid email' }

  const eventId = draft.eventId.trim()
  if (eventId === '') return { ok: false, reason: 'Pick the event to add them to.' }

  const optional = {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    company: draft.company.trim(),
    tagline: draft.tagline.trim(),
  }
  const tooLong = Object.entries(optional).find(([, value]) => value.length > CONTACT_VALUE_MAX)
  if (tooLong !== undefined) {
    return { ok: false, reason: `Keep each field under ${String(CONTACT_VALUE_MAX)} characters.` }
  }

  return {
    ok: true,
    contact: {
      email,
      eventId,
      // Spread rather than assigned, so an empty field carries no key at all instead of an
      // explicit `undefined`. Same shape `profileLogistics` uses.
      ...(optional.firstName === '' ? {} : { firstName: optional.firstName }),
      ...(optional.lastName === '' ? {} : { lastName: optional.lastName }),
      ...(optional.company === '' ? {} : { company: optional.company }),
      ...(optional.tagline === '' ? {} : { tagline: optional.tagline }),
    },
  }
}

/**
 * How the CRM names somebody who was just created, for the toast and for the refusal that
 * points at an existing record.
 *
 * `speakerName` in `speaker-rows.ts` answers the same question for a table row and falls back
 * to the address; this one falls back to the address too, so the two agree, but it is spelled
 * here because that module is the DIRECTORY's row projection and this is a confirmation
 * message. Neither should have to change when the other's fallback does.
 */
export function contactDisplayName(contact: CheckedContact): string {
  const name = [contact.firstName, contact.lastName].filter((part) => part !== undefined).join(' ')
  return name === '' ? contact.email : name
}
