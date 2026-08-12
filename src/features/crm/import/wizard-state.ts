// The import wizard's rules, with no React in them.
//
// Same split, and the same reason, as `step-wizard.ts` beside the StepWizard: this repo
// has no jsdom and no testing-library, so anything that only exists inside a component is only
// testable by rendering it to a string. What a column may be mapped to and what the preview
// says will happen to a row are rules an organizer's real file will find the holes in, so they
// live here and `ImportWizard.tsx` is a renderer over them. Which step is blocked, and why,
// is the other half, in `wizard-gates.ts`.
//
// Everything here is a pure function of what the wizard is holding. There is no store: the
// component owns the file, the choices and the result, exactly as `StepWizard` expects.

import { type ErrorId, ErrorIds } from '@/constants/errorIds'
import { DUPLICATE_OF_ROW_PREFIX } from '@/features/crm/import/dedup'
import { type ImportTarget, MAPPING_TARGETS } from '@/features/crm/import/fields'
import { mapRow } from '@/features/crm/import/map-row'
import type { SpeakerImportRow } from '@/services/airtable/mutations-crm-import-plan'

/**
 * May the wizard mint a NEW submission id after this failure?
 *
 * Yes for every failure except the claim guard's own refusal, and the exception is the whole
 * reason this is a named rule rather than an inline `if`. The wizard regenerates its submission
 * id after a failed commit so a genuine failure - a rate limit, a dropped connection - can be
 * retried against a key the guard has not seen. Doing that for `CRM_IMPORT_ALREADY_CLAIMED`
 * would answer "this import has already been submitted" by handing the next press a key the
 * guard WILL grant, so the second commit lands after all. The guard would then only be stopping
 * a press arriving while the request is in flight, which is the window `StepWizard`'s `busy`
 * already disables the button for, and a Durable Object is not for that.
 *
 * In this module rather than beside the action it pairs with, for two reasons: it is a rule
 * about what the WIZARD does next, and `commit.ts` pulls in Zod, which a `'use client'` module
 * should not be importing for one comparison.
 */
export function retiresAttempt(errorId: ErrorId): boolean {
  return errorId !== ErrorIds.CRM_IMPORT_ALREADY_CLAIMED
}

/** Why the wizard is reconsidering the submission id it is carrying. */
export type AttemptRestart =
  /** The organizer picked a file. Everything downstream of the upload step is being reset. */
  | { readonly kind: 'file' }
  /** A commit came back refused, with this reason. */
  | { readonly kind: 'failure'; readonly errorId: ErrorId }

/**
 * The submission id the wizard carries after `restart`: the current one, or a newly minted one.
 *
 * The claim key's job is "THIS attempt, arriving twice". Two different things can end an
 * attempt, and `retiresAttempt` above only decided one of them, which was the bug: a second
 * import in the same page session was refused for the full `IMPORT_CLAIM_MS` window with
 * "This import has already been submitted", about a file that had never been submitted.
 * Picking a file re-arms the finish control (`ImportWizard` clears `result`) and the Upload
 * step stays reachable from Commit, so the second import is a normal thing to do - and it went
 * out under the first import's id, against a key the first holder still owned.
 *
 * A newly picked file is unconditionally a NEW attempt, and that is not in tension with the
 * failure rule: nothing has been submitted under the new id, so the guard has nothing to
 * protect. The failure rule is unchanged, including its exception - a retry of the SAME file
 * after the guard's own refusal must keep the id, or the guard is re-armed against itself.
 */
export function attemptIdAfter(
  restart: AttemptRestart,
  current: string,
  mint: () => string,
): string {
  if (restart.kind === 'file') return mint()
  return retiresAttempt(restart.errorId) ? mint() : current
}

/**
 * The value the per-column `Select` carries when a column is not imported.
 *
 * A sentinel rather than "no selection", because Radix's `Select` treats an empty string as
 * "nothing chosen" and would render the placeholder instead of the choice the organizer
 * actually made. The label is Sessionboard's own (`docs/parity/external-references.md`), where
 * the control "exists specifically to prevent overwriting existing data".
 */
export const IGNORE_COLUMN = 'ignore'
export const IGNORE_COLUMN_LABEL = 'Ignore this column'

export type ColumnChoice = ImportTarget | typeof IGNORE_COLUMN

/** A CSV row's number in the FILE: row 1 is the header, so the first data row is 2. */
export function fileRowNumber(index: number): number {
  return index + 2
}

/** Every column's starting choice: what `autoMapHeaders` guessed, or ignore. */
export function choicesFromMapping(
  headers: readonly string[],
  mapping: ReadonlyMap<string, ImportTarget>,
): ReadonlyMap<string, ColumnChoice> {
  return new Map(headers.map((header) => [header, mapping.get(header) ?? IGNORE_COLUMN]))
}

/**
 * Point one column at one field, and take that field off whatever column held it.
 *
 * A field can be claimed once, which is `autoMapHeaders`' rule as well: two columns writing
 * one field would make the value depend on iteration order rather than on anything the
 * organizer chose. Rather than refusing the second choice, the earlier column is set back to
 * `Ignore this column`, because the click the organizer just made is the one they meant.
 */
export function chooseColumn(
  choices: ReadonlyMap<string, ColumnChoice>,
  header: string,
  choice: ColumnChoice,
): ReadonlyMap<string, ColumnChoice> {
  const next = new Map(choices)
  if (choice !== IGNORE_COLUMN) {
    for (const [other, held] of next) {
      if (other !== header && held === choice) next.set(other, IGNORE_COLUMN)
    }
  }
  next.set(header, choice)
  return next
}

/** The choices as the mapping `mapRow` takes: ignored columns simply are not in it. */
export function mappingFromChoices(
  choices: ReadonlyMap<string, ColumnChoice>,
): ReadonlyMap<string, ImportTarget> {
  const mapping = new Map<string, ImportTarget>()
  for (const [header, choice] of choices) {
    if (choice !== IGNORE_COLUMN) mapping.set(header, choice)
  }
  return mapping
}

/** One row the mapping could not turn into a speaker, and why. */
export type RejectedRow = { readonly rowNumber: number; readonly reason: string }

export type MappedRows = {
  readonly rows: readonly SpeakerImportRow[]
  /** Rows `mapRow` refused, kept so the preview can count them and the report can echo them. */
  readonly rejected: readonly RejectedRow[]
}

/**
 * Map every parsed row, keeping the rejects rather than dropping them.
 *
 * A rejected row does not stop the import: the write layer's whole promise is that row 7 being
 * malformed still lands rows 1-6 and 8-25, and this is the client-side half of the same
 * promise. The reasons are `mapRow`'s, which are spelled exactly as `planRow` spells them, so
 * one downloadable report reads the same whichever side refused the row.
 */
export function mapRows(
  rawRows: readonly Record<string, string>[],
  mapping: ReadonlyMap<string, ImportTarget>,
): MappedRows {
  const rows: SpeakerImportRow[] = []
  const rejected: RejectedRow[] = []
  rawRows.forEach((raw, index) => {
    const result = mapRow(raw, mapping, fileRowNumber(index))
    if (result.ok) {
      rows.push(result.row)
      return
    }
    rejected.push({ rowNumber: fileRowNumber(index), reason: result.reason })
  })
  return { rows, rejected }
}

/** Everything the preview shows about a row before it says what will happen to it. */
type PreviewedRow = {
  readonly rowNumber: number
  readonly email: string
  /**
   * The name the mapping produced, joined for display. Absent when the file mapped no name at
   * all, which is legitimate: only the address is required.
   *
   * It reads off `firstName` and `lastName` AFTER `mapRow` has run, so a file whose only name
   * column was mapped to the combined `Name` target shows the split the commit is about to
   * write. Somebody checking that a single-column import kept their names can see it here
   * rather than by opening the directory afterwards.
   */
  readonly name?: string
}

/** What the commit will do to one row, as the preview understands it. */
export type RowDisposition =
  | (PreviewedRow & { readonly kind: 'create' })
  | (PreviewedRow & { readonly kind: 'update' })
  | (PreviewedRow & {
      readonly kind: 'repeat'
      /** The earlier row in this same file that will land instead. */
      readonly of: number
    })

/** `First Last`, `First`, `Last`, or nothing. Never a stray space between the two. */
export function importRowName(row: SpeakerImportRow): string | undefined {
  const name = [row.firstName, row.lastName].filter((part) => part !== undefined).join(' ')
  return name === '' ? undefined : name
}

/**
 * What each row will do, read off `findDuplicates`' answer.
 *
 * The map's value says WHAT a row collides with, and the two cases are different events for
 * the organizer: a speaker record id means somebody already in the CRM gets updated, and
 * `row:<n>` means this row repeats an earlier row of the same file and `dedupeRows` will drop
 * it. Anything unmatched is a new speaker.
 *
 * `duplicates` MUST have been computed against the whole Speakers table, not against the CRM
 * directory's rows: the directory list is one already-sliced page of a list scoped to the
 * viewer's events, so a speaker who presents at another event entirely would preview as a
 * create and then be updated by the commit. `previewSpeakerImportAction` reads the base-wide
 * set through the same function the write uses.
 */
export function dispositions(
  rows: readonly SpeakerImportRow[],
  duplicates: ReadonlyMap<number, string>,
): readonly RowDisposition[] {
  return rows.map((row) => {
    const name = importRowName(row)
    // Spread rather than assigned, so a row with no mapped name carries no `name` key at all
    // instead of an explicit `undefined`. Same shape `cardOf` uses in pipeline.ts.
    const shown = {
      rowNumber: row.rowNumber,
      email: row.email,
      ...(name === undefined ? {} : { name }),
    }
    const target = duplicates.get(row.rowNumber)
    if (target === undefined) return { ...shown, kind: 'create' }
    if (target.startsWith(DUPLICATE_OF_ROW_PREFIX)) {
      return {
        ...shown,
        kind: 'repeat',
        of: Number(target.slice(DUPLICATE_OF_ROW_PREFIX.length)),
      }
    }
    return { ...shown, kind: 'update' }
  })
}

export type PreviewCounts = {
  readonly create: number
  readonly update: number
  readonly repeat: number
}

/** The three numbers the preview's summary line carries. */
export function previewCounts(rows: readonly RowDisposition[]): PreviewCounts {
  return {
    create: rows.filter((row) => row.kind === 'create').length,
    update: rows.filter((row) => row.kind === 'update').length,
    repeat: rows.filter((row) => row.kind === 'repeat').length,
  }
}

/**
 * The mapping step's right-hand column: every field a column may be pointed at.
 *
 * `MAPPING_TARGETS` rather than `IMPORTABLE_FIELDS`, which is the difference that lets a file
 * with a single `name` column be imported at all: the combined Name target is offered here and
 * `mapRow` splits it into the two stored fields. See `COMBINED_NAME_TARGET`.
 */
export const COLUMN_CHOICES: readonly { readonly value: ColumnChoice; readonly label: string }[] = [
  { value: IGNORE_COLUMN, label: IGNORE_COLUMN_LABEL },
  ...MAPPING_TARGETS.map((field) => ({
    value: field.key,
    label: field.required ? `${field.label} (required)` : field.label,
  })),
]
