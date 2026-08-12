// Parsing a pasted or uploaded speaker CSV. SPK-03.
//
// Pure and total: no clock, no I/O, no throwing. A malformed row is REPORTED with its line
// number rather than dropped or crashing the import, because the whole point of a bulk
// import is that somebody hands it a file exported from a system nobody here has seen.
//
// A HAND-WRITTEN PARSER, and that is a deliberate choice rather than a missing dependency.
// CSV's real grammar is small (quoted fields, doubled quotes inside them, embedded newlines
// and commas) and every one of those cases is covered below and tested. Pulling a parser in
// would add a dependency to a Workers bundle for eighty lines, and the alternative people
// reach for, `text.split(',')`, silently corrupts exactly the row this feature exists to
// handle: `"Okafor, Ada",ada@example.com`.
//
// The header row decides the columns, and unrecognised headers are IGNORED rather than
// refused. A file exported from another system carries columns this app has no field for,
// and rejecting the whole import over an `Attendee ID` column would be useless behaviour.

import { SPEAKER_STATUSES, type SpeakerStatus } from '@/constants/status'
import { parseCsv, splitFullName } from '@/features/speakers/csv-parse'

// Re-exported: the parser moved to ./csv-parse.ts for the file-size limit and callers
// already import it from here.
export { parseCsv, splitFullName } from '@/features/speakers/csv-parse'

/** One parsed row, ready for the action. Only `email` is required. */
export type SpeakerImportRow = {
  email: string
  firstName?: string
  lastName?: string
  company?: string
  tagline?: string
  bio?: string
  status?: SpeakerStatus
  dietary?: string
  travelNotes?: string
}

export type SpeakerImportProblem = {
  /** 1-based, counting the header, so it matches what a spreadsheet shows. */
  line: number
  message: string
}

export type SpeakerImportPlan = {
  rows: readonly SpeakerImportRow[]
  problems: readonly SpeakerImportProblem[]
}

/**
 * Header spellings this accepts, folded to lowercase with non-letters stripped.
 *
 * Several per field on purpose: `first_name`, `First Name` and `firstname` all arrive from
 * real exports, and making an organizer rename columns to match our internals would be the
 * kind of import that gets abandoned halfway.
 */
/**
 * A parse-time column. `fullName` is not a field on the record: it is one column that
 * carries both halves of a name, split by `splitFullName` before the row is built.
 */
type ImportColumn = keyof SpeakerImportRow | 'fullName'

const HEADERS: ReadonlyMap<string, ImportColumn> = new Map([
  ['email', 'email'],
  ['emailaddress', 'email'],
  // ONE column holding the whole name, which is what most exports and most
  // hand-written lists actually have. Without these the file imported cleanly, reported
  // "Imported 3 speakers", and left three rows whose name cell showed an email address,
  // because the roster falls back to the address when both halves are blank. A silent
  // mis-import is the worst outcome available to this feature.
  ['name', 'fullName'],
  ['fullname', 'fullName'],
  ['speakername', 'fullName'],
  ['displayname', 'fullName'],
  ['firstname', 'firstName'],
  ['first', 'firstName'],
  ['givenname', 'firstName'],
  ['lastname', 'lastName'],
  ['last', 'lastName'],
  ['surname', 'lastName'],
  ['familyname', 'lastName'],
  ['company', 'company'],
  ['organisation', 'company'],
  ['organization', 'company'],
  ['tagline', 'tagline'],
  ['jobtitle', 'tagline'],
  ['title', 'tagline'],
  ['bio', 'bio'],
  ['biography', 'bio'],
  ['status', 'status'],
  ['dietary', 'dietary'],
  ['dietaryrequirements', 'dietary'],
  ['travel', 'travelNotes'],
  ['travelnotes', 'travelNotes'],
])

function headerKey(raw: string): ImportColumn | undefined {
  return HEADERS.get(raw.toLowerCase().replaceAll(/[^a-z]/gu, ''))
}

export function planSpeakerImport(text: string): SpeakerImportPlan {
  const table = parseCsv(text)
  if (table.length === 0) {
    return { rows: [], problems: [{ line: 1, message: 'that file is empty' }] }
  }

  const [header, ...body] = table
  const columns = header.map((cell) => headerKey(cell))
  if (!columns.includes('email')) {
    return {
      rows: [],
      problems: [{ line: 1, message: 'no email column. The header row needs one called Email.' }],
    }
  }

  const rows: SpeakerImportRow[] = []
  const problems: SpeakerImportProblem[] = []
  const seen = new Set<string>()

  // Ignored columns are still IGNORED, per the header note: a file exported from another
  // system carries columns this app has no field for, and refusing the import over an
  // `Attendee ID` would be useless. But saying nothing at all is how a header this app does
  // not recognise turns into an import that reports success and quietly drops a name.
  // Named on line 1 so the preview shows what was and was not read.
  const ignored = header.filter((cell, position) => {
    return columns.at(position) === undefined && cell.trim() !== ''
  })
  if (ignored.length > 0) {
    problems.push({
      line: 1,
      message: `not imported, no matching field: ${ignored.map((cell) => cell.trim()).join(', ')}`,
    })
  }

  for (const [index, cells] of body.entries()) {
    // +2: one for the header, one because a spreadsheet counts from 1.
    const outcome = readRow(cellsByKey(cells, columns), index + 2, seen)
    problems.push(...outcome.problems)
    if (outcome.row !== undefined) {
      seen.add(outcome.row.email)
      rows.push(outcome.row)
    }
  }

  return { rows, problems }
}

/** The row's cells, keyed by the field each column maps to. Unmapped columns are dropped. */
function cellsByKey(
  cells: readonly string[],
  columns: readonly (ImportColumn | undefined)[],
): ReadonlyMap<ImportColumn, string> {
  const values = new Map<ImportColumn, string>()
  for (const [position, key] of columns.entries()) {
    if (key === undefined) continue
    values.set(key, (cells.at(position) ?? '').trim())
  }

  // The one-column name, expanded here so nothing below has to know it existed. An
  // explicit First/Last pair WINS: a file carrying both is telling us where the boundary
  // is, and guessing over the top of that would be worse than not guessing at all.
  const full = values.get('fullName')
  if (full !== undefined && full !== '') {
    const split = splitFullName(full)
    if ((values.get('firstName') ?? '') === '') values.set('firstName', split.firstName)
    if ((values.get('lastName') ?? '') === '') values.set('lastName', split.lastName)
  }

  return values
}

/** One row: the record it becomes, or nothing, plus whatever is worth telling the operator. */
function readRow(
  values: ReadonlyMap<ImportColumn, string>,
  line: number,
  seen: ReadonlySet<string>,
): { row?: SpeakerImportRow; problems: readonly SpeakerImportProblem[] } {
  const email = (values.get('email') ?? '').toLowerCase()
  if (email === '') return { problems: [{ line, message: 'no email address' }] }
  if (!isEmail(email)) {
    return { problems: [{ line, message: `"${email}" is not an email address` }] }
  }
  // Deduplicated within the FILE, not against the base: a repeated address here would be two
  // writes racing to upsert the same record, and the second would overwrite the first with
  // whatever that row happened to hold.
  if (seen.has(email)) {
    return { problems: [{ line, message: `${email} appears more than once in this file` }] }
  }

  const raw = values.get('status') ?? ''
  const status = SPEAKER_STATUSES.find((known) => known === raw.toLowerCase())
  // Reported and then IGNORED rather than failing the row: an unknown status means a column
  // this app does not share a vocabulary with, and losing the person over it would be worse
  // than importing them as a prospect.
  const problems =
    raw !== '' && status === undefined
      ? [{ line, message: `unknown status "${raw}", imported as prospect` }]
      : []

  return {
    row: {
      email,
      ...optional('firstName', values),
      ...optional('lastName', values),
      ...optional('company', values),
      ...optional('tagline', values),
      ...optional('bio', values),
      ...optional('dietary', values),
      ...optional('travelNotes', values),
      ...(status === undefined ? {} : { status }),
    },
    problems,
  }
}

function optional(
  key: Exclude<keyof SpeakerImportRow, 'email' | 'status'>,
  values: ReadonlyMap<ImportColumn, string>,
): Partial<SpeakerImportRow> {
  const value = values.get(key)
  return value === undefined || value === '' ? {} : { [key]: value }
}

/**
 * Deliberately loose. This is a paste-and-import box, not a signup form: the address is
 * checked for shape so a name in the wrong column is caught, and anything past that is the
 * mail provider's job to reject.
 */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}
