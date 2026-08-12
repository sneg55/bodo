// What a speaker CSV import is allowed to write, and how much of it at once.
//
// The field union, the row shape and the outcome shape are IMPORTED from the write layer
// rather than redeclared. They were declared in `mutations-crm-import-plan.ts` because this
// module did not exist when that one was built (see its file header); now that it does, one
// declaration stays authoritative and this file re-exports it. A structurally identical
// second copy would type-check today and drift the first time either side gains a field.

import type { SpeakerImportField } from '@/services/airtable/mutations-crm-import-plan'

export type { SpeakerImportField }

export type ImportableField = {
  readonly key: SpeakerImportField
  readonly label: string
  /** Only `email` is required: it is the identity a row is matched and deduplicated on. */
  readonly required: boolean
}

/**
 * The mapping step's left-hand column, in the order it renders.
 *
 * Labels are the ones the CRM directory already shows for the same key
 * (`SPEAKER_CRM_FIELDS`), spelled out here rather than looked up: a label lookup that misses
 * has to fall back to something, and a silent fallback is exactly the drift this guards
 * against. A test asserts the two agree, so a rename in the catalog fails there instead.
 *
 * The seven are the intersection of `Speaker` and what a spreadsheet plausibly carries.
 * Salutation, honorific, pronouns and gender are deliberately absent: they are
 * self-described fields a speaker fills in about themselves, and importing them off an
 * organizer's spreadsheet is how a roster ends up asserting someone's pronouns for them.
 * Headshot and the social links are absent because a URL column would have to be fetched and
 * re-hosted, which is a different feature. All of them remain editable in the portal.
 */
export const IMPORTABLE_FIELDS: readonly ImportableField[] = [
  { key: 'email', label: 'Email', required: true },
  { key: 'firstName', label: 'First Name', required: false },
  { key: 'lastName', label: 'Last Name', required: false },
  { key: 'company', label: 'Company', required: false },
  { key: 'tagline', label: 'Tagline', required: false },
  { key: 'phone', label: 'Mobile Phone', required: false },
  { key: 'bio', label: 'Biography', required: false },
]

/**
 * The combined-name column, which is a MAPPING TARGET and not a stored field.
 *
 * Most speaker exports carry one `Name` column rather than two, and until this existed the
 * only thing such a file could be told to do with it was `Ignore this column`: the mapping
 * step offered `First Name` and `Last Name`, so the organizer had to split the column in a
 * spreadsheet before bodo would take it, and an import that dropped every name on the way in
 * is not an import of speakers.
 *
 * It is deliberately NOT a `SpeakerImportField`. Nothing is stored under this key: `mapRow`
 * splits the cell and writes `firstName` and `lastName`, so the payload schema, the write
 * layer and the error report all keep seeing exactly the seven columns they already knew
 * about, and a hand-built POST cannot smuggle a `fullName` value into a Speakers row.
 */
export const COMBINED_NAME_TARGET = 'fullName'

/** A column may be pointed at one of the seven writable fields, or at the combined name. */
export type ImportTarget = SpeakerImportField | typeof COMBINED_NAME_TARGET

export type MappingTarget = {
  readonly key: ImportTarget
  readonly label: string
  readonly required: boolean
}

/**
 * Everything a column may be pointed at, in the order the mapping step renders.
 *
 * Built from `IMPORTABLE_FIELDS` rather than typed out a second time, so a field added there
 * appears here without anyone remembering to. `Name` is inserted immediately BEFORE
 * `First Name`, which is where an organizer scanning the list for a name field looks first;
 * splicing on that key rather than on a position means a reorder of the catalog cannot
 * silently move it somewhere else. `tests/crm-import-name-split.test.ts` pins the placement.
 */
export const MAPPING_TARGETS: readonly MappingTarget[] = IMPORTABLE_FIELDS.flatMap((field) =>
  field.key === 'firstName'
    ? [{ key: COMBINED_NAME_TARGET, label: 'Name', required: false } as const, field]
    : [field],
)

/**
 * Rows accepted from one uploaded file.
 *
 * A CHOSEN CONSERVATIVE STARTING VALUE, not a measured limit: there are no Airtable
 * credentials in this environment, so nothing here has been timed against a real base. The
 * shape of the constraint is known - the import commits synchronously through the DAL's
 * per-base scheduler at 10 records per request, inside one Workers request - so the real
 * ceiling is whatever the Worker's wall clock allows, and 500 rows is 50 sequential requests.
 * Raise it once someone has watched a real import finish. Sessionboard states 1,000 records
 * per file (`docs/parity/external-references.md`), which is the number to aim at, not the
 * number to adopt untested.
 */
export const IMPORT_ROW_CAP = 500
