// A table declaration and the field builders it is written with.
//
// Two things live here and nothing else: the shape a declaration has, and one
// builder per Airtable Meta API field type. The builders exist because the wire
// format wants an options object per type (`{ choices }` on a select, a date
// format and a timezone on a dateTime, a precision on a number) and spelling that
// at 200 field sites is how one column ends up with a different date format than
// the column next to it. Each type name is written once, inside its builder.
//
// A link carries the target table's NAME, not its id. Ids only exist once a table
// has been created, so a declaration that named ids could not describe a base that
// does not exist yet, which is the only base this migration is ever run against
// first. `apply` resolves the name against the base it just read.

/** An Airtable Meta API field type name, as the API spells it. */
export type MetaFieldType =
  | 'singleLineText'
  | 'multilineText'
  | 'email'
  | 'url'
  | 'phoneNumber'
  | 'number'
  | 'checkbox'
  | 'singleSelect'
  | 'dateTime'
  | 'autoNumber'
  | 'multipleRecordLinks'

export type FieldSpec = {
  readonly name: string
  readonly type: MetaFieldType
  /** Sent verbatim as the field's `options`. Absent for types that take none. */
  readonly options?: Readonly<Record<string, unknown>>
  /** Target table name, set on `multipleRecordLinks` only. */
  readonly linkTo?: string
}

export type TableSpec = {
  readonly name: string
  /**
   * The first entry becomes the table's primary field, so it must be a type
   * Airtable accepts there: never a checkbox, a link, or a select. Every table
   * below leads with text or an autonumber for that reason.
   */
  readonly fields: readonly FieldSpec[]
}

const ISO = { name: 'iso' } as const

/**
 * Every dateTime column in this base stores an instant in UTC and is read back as
 * an ISO string by `optionalText` in records.ts. The timezone is fixed here rather
 * than left to the field's default because a column displayed in a local zone
 * round-trips through the API as that zone's offset, and the agenda then compares
 * two instants that were never in the same frame.
 */
const DATE_TIME_OPTIONS = {
  dateFormat: ISO,
  timeFormat: { name: '24hour' },
  timeZone: 'utc',
} as const

export const text = (name: string): FieldSpec => ({ name, type: 'singleLineText' })

/** Long text: prose with a character cap, and every `...Json` blob column. */
export const longText = (name: string): FieldSpec => ({ name, type: 'multilineText' })

export const emailField = (name: string): FieldSpec => ({ name, type: 'email' })

export const urlField = (name: string): FieldSpec => ({ name, type: 'url' })

export const phoneField = (name: string): FieldSpec => ({ name, type: 'phoneNumber' })

/**
 * `precision` is the number of decimal places. Zero for counts and sort orders,
 * which is also what `optionalNumber` expects to hand the app: a precision that
 * allows decimals on `capacity` invites a room that seats 119.5 people.
 */
export const numberField = (name: string, precision = 0): FieldSpec => ({
  name,
  type: 'number',
  options: { precision },
})

export const checkboxField = (name: string): FieldSpec => ({
  name,
  type: 'checkbox',
  // Required on create: the API rejects a checkbox with no icon or colour.
  options: { color: 'greenBright', icon: 'check' },
})

/**
 * A single select with its full choice list, which is the whole reason selects are
 * declared rather than left as text. `requiredChoice` in records.ts throws on a
 * value outside the vocabulary, so a choice missing from the base is a row the DAL
 * refuses to read, and an organizer typing a new option into a text column is a
 * filter that silently matches nothing.
 */
export const select = (name: string, choices: readonly string[]): FieldSpec => ({
  name,
  type: 'singleSelect',
  options: { choices: choices.map((choice) => ({ name: choice })) },
})

export const dateTimeField = (name: string): FieldSpec => ({
  name,
  type: 'dateTime',
  options: DATE_TIME_OPTIONS,
})

/**
 * `autoNumber` CANNOT be created through the Meta API, and this is verified rather than
 * assumed: creating the Submissions table with it returns 422
 * `UNSUPPORTED_FIELD_TYPE_FOR_CREATE`. Airtable computes the value, so the API refuses to
 * accept a definition for it, along with formula, rollup, count, lookup, button and the
 * created/modified metadata types.
 *
 * Declared anyway, because the declaration is also the record of what the schema IS, and
 * the DAL reads this column: `mapSubmission` turns it into the `SESS-<n>` code every
 * screen shows. Dropping it from the declaration would make the migration's own report
 * claim the base matches when the one column a speaker quotes back to an organizer is
 * missing.
 *
 * `apply` therefore skips these and reports them as manual steps. See MANUAL_FIELD_TYPES.
 */
export const autoNumber = (name: string): FieldSpec => ({ name, type: 'autoNumber' })

/**
 * Field types the Meta API will not create, so the migration reports them instead of
 * failing on them. Adding one by hand is a few seconds of clicking, once per base; a
 * migration that dies on the fifth of 29 tables leaves a half-built base instead.
 */
export const MANUAL_FIELD_TYPES: ReadonlySet<MetaFieldType> = new Set(['autoNumber'])

/** Whether `apply` has to leave this field to a human. */
export function needsManualCreation(field: FieldSpec): boolean {
  return MANUAL_FIELD_TYPES.has(field.type)
}

export const link = (name: string, linkTo: string): FieldSpec => ({
  name,
  type: 'multipleRecordLinks',
  linkTo,
})

/** True for a field whose creation has to wait until its target table exists. */
export const isLink = (field: FieldSpec): boolean => field.linkTo !== undefined
