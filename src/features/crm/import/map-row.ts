// Header auto-mapping and one CSV row to one `SpeakerImportRow`.
//
// Pure and synchronous: it takes what `parseCsv` produced and answers with either a row the
// write layer can take or a reason it cannot. Nothing here reaches Airtable, and nothing
// here decides whether a row is a duplicate; that is `dedup.ts`.

import type {
  SpeakerImportField,
  SpeakerImportRow,
} from '@/services/airtable/mutations-crm-import-plan'
import {
  COMBINED_NAME_TARGET,
  IMPORTABLE_FIELDS,
  type ImportableField,
  type ImportTarget,
} from './fields'

/**
 * Fold a header down to letters and digits: `"E-Mail Address"` and `"email_address"` both
 * become `emailaddress`.
 *
 * Unicode-aware (`\p{L}\p{N}`) rather than `[a-z0-9]`, so an accented header keeps its
 * letters instead of being silently mangled into a different word. A UTF-8 BOM on the first
 * header of a file is neither a letter nor a digit and disappears here, which is why a
 * BOM-prefixed `Email` still maps.
 */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Normalized header spellings that identify a field, first entry first.
 *
 * Deliberately NOT exhaustive and deliberately not clever. Anything unrecognised stays
 * unmapped and the organizer picks it on the mapping step, which is a two-second correction;
 * a wrong guess writes the wrong column onto real people and is only noticed later. That is
 * why bare `title` is absent from `tagline`: on a speaker sheet it is as likely to mean
 * `Dr` as `Head of Platform`, and there is no way to tell from the header alone.
 */
const SYNONYMS: readonly (readonly [ImportTarget, readonly string[]])[] = [
  ['email', ['email', 'emailaddress', 'mail', 'mailaddress', 'contactemail', 'speakeremail']],
  // The combined column, listed before the two it splits into so a reader meets it in the
  // order the mapping step draws it. Every spelling here is a WHOLE name: `companyname` and
  // `firstname` normalize to their own words and cannot collide with these.
  [
    COMBINED_NAME_TARGET,
    ['name', 'fullname', 'speakername', 'contactname', 'displayname', 'presentername'],
  ],
  ['firstName', ['firstname', 'first', 'givenname', 'forename', 'fname']],
  ['lastName', ['lastname', 'last', 'surname', 'familyname', 'lname']],
  ['company', ['company', 'companyname', 'organization', 'organisation', 'employer', 'org']],
  ['tagline', ['tagline', 'headline', 'jobtitle', 'position', 'role']],
  ['phone', ['phone', 'phonenumber', 'mobile', 'mobilephone', 'mobilenumber', 'cell', 'telephone']],
  ['bio', ['bio', 'biography', 'about', 'aboutme', 'speakerbio', 'shortbio']],
]

const FIELD_BY_SPELLING: ReadonlyMap<string, ImportTarget> = new Map(
  SYNONYMS.flatMap(([field, spellings]) => spellings.map((s) => [s, field] as const)),
)

/** What a combined `Name` cell contributes to a row. Either half may be absent. */
export type SplitName = {
  readonly firstName?: string
  readonly lastName?: string
}

/**
 * Split one combined name cell into a first and a last name.
 *
 * THE RULE: the last whitespace-separated token is the last name and everything before it is
 * the first name, so `Ada Lovelace` splits cleanly and `Ada King Lovelace` keeps `Ada King`
 * together rather than inventing a middle-name field the schema does not have. A single token
 * is a FIRST name and not a last one: `Prince` and `Madonna` are people's names, `lastName` is
 * what the directory sorts on, and filing a mononym under the surname column would sort them
 * away from the row an organizer typed. Nothing else is inferred - no comma-reversal for
 * `Lovelace, Ada`, no particle handling for `van Rijn` - because each of those is a guess that
 * writes the wrong thing onto a real person, and the mapping step's own First Name / Last Name
 * targets are the two-second correction for a file that needs one.
 *
 * Internal whitespace is collapsed on the way through (`\s+`), so a cell pasted out of a
 * spreadsheet with a double space does not produce a first name with a gap in it.
 */
export function splitFullName(value: string): SplitName {
  const tokens = value
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== '')
  const last = tokens.at(-1)
  if (last === undefined) return {}
  if (tokens.length === 1) return { firstName: last }
  return { firstName: tokens.slice(0, -1).join(' '), lastName: last }
}

/**
 * Guess a field for each header, left to right.
 *
 * A field is claimed at most once. A file with both `Email` and `Email Address` gets the
 * first mapped and the second left for the organizer to `Ignore this column` or reassign,
 * because two headers writing one field would make the row's value depend on map iteration
 * order rather than on anything the organizer chose.
 *
 * `Name` is NOT mutually exclusive with `First Name` and `Last Name` here, and that is on
 * purpose. A file carrying all three maps all three, and `mapRow` then lets the two specific
 * columns win over the split. Blocking the pair once `Name` was claimed would make the outcome
 * depend on which of them the export happened to put first, which is the very thing the
 * claim-once rule above exists to avoid.
 */
export function autoMapHeaders(headers: readonly string[]): ReadonlyMap<string, ImportTarget> {
  const mapping = new Map<string, ImportTarget>()
  const claimed = new Set<ImportTarget>()
  for (const header of headers) {
    if (mapping.has(header)) continue
    const field = FIELD_BY_SPELLING.get(normalizeHeader(header))
    if (field === undefined || claimed.has(field)) continue
    claimed.add(field)
    mapping.set(header, field)
  }
  return mapping
}

/** The required fields no header maps to yet. Empty means the mapping step can advance. */
export function missingRequiredFields(
  mapping: ReadonlyMap<string, ImportTarget>,
): readonly ImportableField[] {
  const mapped = new Set(mapping.values())
  return IMPORTABLE_FIELDS.filter((field) => field.required && !mapped.has(field.key))
}

export type MapRowResult =
  | { readonly ok: true; readonly row: SpeakerImportRow }
  | { readonly ok: false; readonly reason: string }

/**
 * Turn one parsed row into a `SpeakerImportRow`, or say why it cannot be one.
 *
 * The two rejection reasons are `Missing email` and `Invalid email`, spelled exactly as
 * `planRow` spells them (`mutations-crm-import-plan.ts`). A row can fail here or fail there,
 * and one downloadable error report carries both, so the same problem has to read the same
 * way in it.
 *
 * When two headers map to one field, the first NON-EMPTY one wins, not simply the first.
 * `autoMapHeaders` never produces such a mapping, but an organizer can, and a file with an
 * empty `Email` column beside a filled `Contact Email` is a real export shape: taking the
 * first header unconditionally would reject the row as `Missing email` while the address sat
 * one column over. The rule is a consequence of the loop below skipping empty cells; it is
 * documented because it is behaviour somebody will otherwise assume away.
 *
 * An empty cell is OMITTED rather than carried through as `''`. `speakerFields` drops
 * `undefined` and writes everything else, so a blank column on a row that turns out to be an
 * UPDATE would otherwise erase a bio somebody already wrote. Sessionboard makes the same
 * point about its `Ignore this column` control, which exists "specifically to prevent
 * overwriting existing data" (`docs/parity/external-references.md`).
 *
 * The email is trimmed but NOT lowercased. `planRow` and `loadSpeakersByEmail` both normalize
 * before matching and before writing, so casing here changes nothing downstream, and keeping
 * what the organizer typed means the preview and the error report echo their own file back
 * at them. `dedup.ts` normalizes for its own comparisons.
 *
 * A column mapped to the combined `Name` target is SPLIT here and never carried through under
 * its own key: `splitFullName` supplies `firstName` and `lastName`, and a column mapped
 * explicitly to either of those overwrites the split half. Specific beats derived, whichever
 * order the headers appear in, so a file with `Name` and `Last Name` keeps the surname the
 * organizer's own column stated. Nothing downstream of this function knows the target exists.
 */
export function mapRow(
  row: Record<string, string>,
  mapping: ReadonlyMap<string, ImportTarget>,
  rowNumber: number,
): MapRowResult {
  // A Map read rather than `row[header]`, because `security/detect-object-injection` treats
  // a computed read on a plain object as a sink and its warnings fail this build.
  const cells = new Map(Object.entries(row))
  const values = new Map<ImportTarget, string>()
  for (const [header, field] of mapping) {
    if (values.has(field)) continue
    const value = (cells.get(header) ?? '').trim()
    if (value !== '') values.set(field, value)
  }

  const email = values.get('email') ?? ''
  if (email === '') return { ok: false, reason: 'Missing email' }
  if (!email.includes('@')) return { ok: false, reason: 'Invalid email' }

  const split = splitFullName(values.get(COMBINED_NAME_TARGET) ?? '')
  values.delete(COMBINED_NAME_TARGET)
  const optional = Object.fromEntries(values) as Partial<Record<SpeakerImportField, string>>
  return { ok: true, row: { ...split, ...optional, rowNumber, email } }
}
