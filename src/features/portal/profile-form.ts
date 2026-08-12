// The profile form: its field names, its one cap, and the draft it produces.
//
// Field labels and the panel split come from docs/parity/speaker-portal.md ref 18:
// a `General` panel holding Biography, Salutation, First Name, Last Name, Honorific,
// Pronouns and Gender, and a `My Links` panel holding LinkedIn URL, X (Twitter) URL,
// Facebook URL and Website.
//
// The mapping from posted names to a `SpeakerDraft` is here rather than in the action
// so it can be asserted directly. Three things about it are easy to get wrong and
// invisible once wrong: the 5,000 character Biography cap the counter promises has to
// be enforced on the server as well, since the counter is a client component and the
// action is an open POST; a field the speaker CLEARED has to post an empty string
// rather than being omitted, because `speakerFields` drops undefined and an omitted
// field leaves the old value in Airtable forever; and a field that never posted AT ALL
// is not the same event as a cleared one, which is the distinction `read` now keeps.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type Choice, GENDERS, isChoice, PRONOUNS } from '@/constants/vocabularies'
import type { SpeakerDraft } from '@/services/airtable/to-fields'
import type { SpeakerLinks } from '@/types/domain'

/** The `0 / 5,000 characters` counter under the Biography editor, ref 18. */
export const BIO_MAX_LENGTH = 5000

/** Rendered in the counter and nowhere else, so the thousands separator is literal. */
export const BIO_MAX_LABEL = '5,000'

export const PROFILE_FIELD_NAMES = {
  bio: 'bio',
  salutation: 'salutation',
  firstName: 'firstName',
  lastName: 'lastName',
  honorific: 'honorific',
  pronouns: 'pronouns',
  gender: 'gender',
  linkedin: 'linkedin',
  x: 'x',
  facebook: 'facebook',
  website: 'website',
} as const

/**
 * Fixed option lists. Ref 18 shows both as selects with a `Select...` placeholder and
 * nothing else, and the parity audit lists "whether Pronouns and Gender option lists
 * are fixed or organizer-configurable" as an open ambiguity. Fixed is the smaller
 * commitment: turning a constant into an event setting later touches this file and the
 * form, whereas an organizer-configurable list that nobody configures renders empty.
 *
 * Re-exported from `@/constants/vocabularies` rather than spelled here. They WERE
 * spelled here, in display capitalisation, while the migration declared the Airtable
 * choices in lowercase, so picking any Gender wrote an undeclared select option and
 * Airtable rejected the entire speaker record with a 422. That is why the option now
 * carries a stored `value` and a displayed `label` separately.
 */
export const PRONOUN_OPTIONS: readonly Choice[] = PRONOUNS

export const GENDER_OPTIONS: readonly Choice[] = GENDERS

/** The `Select...` placeholder both selects show, ref 18. */
export const SELECT_PLACEHOLDER = 'Select...'

/** The Biography placeholder, ref 18. */
export const BIO_PLACEHOLDER = 'Enter text here...'

/**
 * Build the write from what was posted.
 *
 * Trimmed, and empty strings are kept as empty strings rather than turned into
 * undefined, so clearing a field actually clears it. The email is NOT taken from the
 * form: it is the identity the session and the magic link both key on, and accepting
 * it from a posted field would let a speaker rewrite their own account's identity.
 *
 * **A field that is absent from the post is left out of the draft entirely, and that is
 * not the same thing as a cleared one.** `speakerFields` drops undefined, so an omitted
 * field leaves Airtable's stored value alone, while a posted empty string reaches
 * `blank()` and actually clears the cell. Reading an absent key as `''` collapsed the two,
 * and the Biography is where that had teeth: its editor is a `next/dynamic` chunk with
 * `ssr: false` (`BiographyEditor`), and the hidden input that carries the value lives
 * INSIDE that chunk, so until it lands, or if it never lands, the form has no `bio` entry
 * at all. Save is enabled the whole time. A speaker who opened the page and tidied their
 * links in that window posted no bio and had their stored biography blanked, with the
 * counter reading `0 / 5,000` as though the field had always been empty.
 *
 * `storedLinks` exists for the same reason on the one field that is written whole:
 * `links` is a single JSON column, so a link the form did not post is filled from the
 * record rather than dropped, and a post carrying none of the four leaves the column
 * untouched.
 */
export function profileDraftFrom(
  posted: ReadonlyMap<string, string>,
  email: string,
  storedLinks: SpeakerLinks = {},
): SpeakerDraft {
  const bio = read(posted, PROFILE_FIELD_NAMES.bio)
  if (bio !== undefined && bio.length > BIO_MAX_LENGTH) {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `Biography is capped at ${BIO_MAX_LABEL} characters`,
      { length: bio.length, max: BIO_MAX_LENGTH },
    )
  }

  return {
    email,
    bio,
    salutation: read(posted, PROFILE_FIELD_NAMES.salutation),
    firstName: read(posted, PROFILE_FIELD_NAMES.firstName),
    lastName: read(posted, PROFILE_FIELD_NAMES.lastName),
    honorific: read(posted, PROFILE_FIELD_NAMES.honorific),
    pronouns: readChoice(posted, PROFILE_FIELD_NAMES.pronouns, PRONOUNS, 'Pronouns'),
    gender: readChoice(posted, PROFILE_FIELD_NAMES.gender, GENDERS, 'Gender'),
    links: readLinks(posted, storedLinks),
  }
}

/**
 * The four links, or `undefined` when the post carried none of them.
 *
 * They share one JSON column, so they cannot be omitted individually the way every other
 * field can: writing `{}` would clear all four. Absent means "keep what is stored" here
 * too, it just has to be resolved against the record to say so.
 *
 * KNOWN, and accepted rather than fixed. Two CONCURRENT posts that each carry a different
 * strict subset of the four can resurrect a link the other one cleared, because both resolve
 * their gaps against the same pre-write baseline and the later write wins with a stale value
 * (Codex review, 2026-08-10). It is unreachable through the product: `ProfileFields` renders
 * all four inputs inside one `<form>`, so a real submission always carries all four keys and
 * this function never sees a partial set. Reaching it means a speaker hand-building two
 * overlapping requests against their own record, and the worst outcome is their own link
 * coming back. The alternative, dropping the baseline, reinstates the data loss this whole
 * function exists to stop: an absent key would clear the column. Fixing it properly needs a
 * compare-and-swap Airtable does not have.
 */
function readLinks(
  posted: ReadonlyMap<string, string>,
  stored: SpeakerLinks,
): SpeakerLinks | undefined {
  const linkedin = read(posted, PROFILE_FIELD_NAMES.linkedin)
  const x = read(posted, PROFILE_FIELD_NAMES.x)
  const facebook = read(posted, PROFILE_FIELD_NAMES.facebook)
  const website = read(posted, PROFILE_FIELD_NAMES.website)

  if ([linkedin, x, facebook, website].every((value) => value === undefined)) return undefined

  return {
    linkedin: linkedin ?? stored.linkedin,
    x: x ?? stored.x,
    facebook: facebook ?? stored.facebook,
    website: website ?? stored.website,
  }
}

/** The posted value, trimmed, or `undefined` when the form did not post the field. */
function read(posted: ReadonlyMap<string, string>, name: string): string | undefined {
  const value = posted.get(name)
  return value === undefined ? undefined : value.trim()
}

/**
 * A select's answer, rejected here rather than by Airtable.
 *
 * An undeclared single-select value comes back as a 422 that rejects the WHOLE
 * record, so one bad dropdown loses the bio, the headshot and every link posted with
 * it. Caught here it costs one legible message and nothing else. `''` passes through
 * untouched: it means the speaker cleared the field, and `blank()` at the Airtable
 * boundary turns it into the `null` that actually clears a select. `undefined` passes
 * through as well, and means the select never posted, so there is nothing to validate
 * and nothing to write.
 */
function readChoice(
  posted: ReadonlyMap<string, string>,
  name: string,
  choices: readonly Choice[],
  label: string,
): string | undefined {
  const value = read(posted, name)
  if (value === undefined || value === '' || isChoice(choices, value)) return value
  throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, `${label} is not one of the offered options`, {
    field: name,
    value,
  })
}
