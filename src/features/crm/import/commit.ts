// What a committed speaker import ADDS UP TO, and the gate its payload has to pass first.
//
// Pure and synchronous on purpose, with no `'use server'` directive: a `'use server'` file may
// only export async functions (the same reason `action-result.ts` sits next to the actions
// rather than inside them), and `summarize` is a fold over an array. The action that calls
// all of this is `./actions.ts`.
//
// The division of labour with the write layer is worth stating, because two files could
// plausibly own each half. `upsertSpeakersBatch` answers ONE OUTCOME PER ROW and never throws
// for a bad row; this module turns that list into the three counts the summary screen shows
// and the failure list the error report is built from. Nothing here re-decides whether a row
// was a create or an update.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { IMPORT_ROW_CAP, IMPORTABLE_FIELDS } from '@/features/crm/import/fields'
import type {
  ImportRowOutcome,
  SpeakerImportRow,
} from '@/services/airtable/mutations-crm-import-plan'

export type { ImportRowOutcome }

/** One row that did not land, in the shape `buildErrorCsv` and the summary screen read. */
export type ImportFailure = {
  readonly rowNumber: number
  readonly email: string
  readonly reason: string
}

export type ImportSummary = {
  readonly created: number
  readonly updated: number
  readonly failed: number
  readonly failures: readonly ImportFailure[]
}

/**
 * Fold the write layer's per-row outcomes into the numbers the last step shows.
 *
 * An empty batch answers zeroes rather than throwing, because an empty batch is reachable:
 * a file whose every row was dropped as a repeat, or an organizer who removed the last
 * mapped column, still presses the same button and still deserves a screen that says what
 * happened.
 *
 * `failures` keeps input order rather than sorting by row number. The outcomes arrive in the
 * caller's row order (`upsertSpeakersBatch` maps over its input), so the report reads down
 * the file the way the organizer's spreadsheet does.
 */
export function summarize(outcomes: readonly ImportRowOutcome[]): ImportSummary {
  const failures: ImportFailure[] = []
  let created = 0
  let updated = 0
  for (const outcome of outcomes) {
    if (outcome.status === 'created') created += 1
    if (outcome.status === 'updated') updated += 1
    if (outcome.status === 'failed') {
      failures.push({
        rowNumber: outcome.rowNumber,
        email: outcome.email,
        reason: outcome.reason,
      })
    }
  }
  return { created, updated, failed: failures.length, failures }
}

/**
 * Refuse a batch bigger than one request can be trusted to finish.
 *
 * Named separately from the payload gate because the wizard calls it too, on the upload step,
 * where it is a blocker with a sentence in it rather than a throw: an organizer who picked a
 * 900-row export should be told so while the file is still on screen, not after pressing
 * Import. `IMPORT_ROW_CAP` is a chosen starting value and its own doc comment says so.
 */
export function checkRowCap(rowCount: number): void {
  if (rowCount <= IMPORT_ROW_CAP) return
  throw new AppError(
    ErrorIds.CRM_ROW_CAP_EXCEEDED,
    `This file has ${rowCount} rows and the import accepts ${IMPORT_ROW_CAP} at a time. Split it and upload the parts.`,
    { rowCount, cap: IMPORT_ROW_CAP },
  )
}

/**
 * Hostile-payload bounds, not content validation.
 *
 * A value longer than these did not come from a spreadsheet cell anybody typed, and the point
 * is only that a single POST cannot make the server carry megabytes into an Airtable write.
 * What an organizer can actually get wrong - a missing address, an address with no `@` - is
 * decided per row by `mapRow` and `planRow`, which answer with one failed row and a reason
 * the error report can echo, rather than discarding the other 499 rows.
 */
const MAX_EMAIL = 320
const MAX_BIO = 20_000
const MAX_VALUE = 1_000

const rowSchema = z.object({
  rowNumber: z.number().int().min(1),
  email: z.string().max(MAX_EMAIL),
  firstName: z.string().max(MAX_VALUE).optional(),
  lastName: z.string().max(MAX_VALUE).optional(),
  company: z.string().max(MAX_VALUE).optional(),
  tagline: z.string().max(MAX_VALUE).optional(),
  phone: z.string().max(MAX_VALUE).optional(),
  bio: z.string().max(MAX_BIO).optional(),
})

/**
 * The seven keys above, spelled out rather than generated from `IMPORTABLE_FIELDS`, so each
 * one carries its own bound. `tests/crm-import-commit.test.ts` asserts the two agree, which
 * is where a field added to the catalog and forgotten here fails.
 */
export const IMPORT_PAYLOAD_FIELD_KEYS: readonly string[] = Object.keys(rowSchema.shape).filter(
  (key) => key !== 'rowNumber',
)

const payloadSchema = z.object({
  /**
   * The client's id for THIS attempt, which is what `claimOnce` keys on so a double submit
   * cannot commit twice. Opaque here: the action namespaces it with the caller's own id, so
   * nothing a client sends can collide with another organizer's import.
   */
  submissionId: z.string().min(1).max(128),
  /** Which event the speakers are added to. Checked against the caller's memberships. */
  eventId: z.string().min(1).max(64),
  rows: z.array(rowSchema),
})

export type ImportPayload = z.infer<typeof payloadSchema>

/** Rows as they arrive, once the shape is known. Still to be deduplicated. */
export type ImportPayloadRow = z.infer<typeof rowSchema>

/**
 * Parse a Server Action argument rather than trusting it.
 *
 * The wizard is one client; anything that can reach the endpoint is another. Unknown keys are
 * dropped rather than rejected (Zod's default), which is what keeps a column the organizer
 * mapped to nothing, or a field a future version sends, from failing an import that is
 * otherwise fine - and what stops a hand-built POST from writing a Speakers column the import
 * is not allowed to touch, since only the seven above survive.
 *
 * The row count is checked BEFORE the rows are parsed, so a payload claiming a million rows is
 * refused without walking them, and refused with the sentence an organizer can act on rather
 * than with a Zod issue list.
 */
export function parseImportPayload(input: unknown): ImportPayload {
  checkRowCap(rawRowCount(input))

  const parsed = payloadSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError(
      ErrorIds.CRM_CSV_UNPARSEABLE,
      'That import could not be read. Re-upload the file and try again.',
      { issues: parsed.error.issues.slice(0, 5) },
    )
  }
  return parsed.data
}

/**
 * The preview asks a narrower question than the commit, so it sends a narrower payload: which
 * row carries which address, and nothing else. A bio has no bearing on whether a row is a
 * duplicate, and not sending one keeps the round trip small and keeps text an organizer
 * pasted out of a spreadsheet off a request that does not need it.
 */
const previewSchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int().min(1), email: z.string().max(MAX_EMAIL) })),
})

export function parsePreviewPayload(input: unknown): readonly SpeakerImportRow[] {
  checkRowCap(rawRowCount(input))

  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError(
      ErrorIds.CRM_CSV_UNPARSEABLE,
      'That preview could not be read. Re-upload the file and try again.',
      { issues: parsed.error.issues.slice(0, 5) },
    )
  }
  return parsed.data.rows
}

/** How many rows the payload CLAIMS, before any of them has been looked at. */
function rawRowCount(input: unknown): number {
  if (typeof input !== 'object' || input === null) return 0
  const rows: unknown = (input as { rows?: unknown }).rows
  return Array.isArray(rows) ? rows.length : 0
}

/**
 * The payload's rows as the write layer's row type.
 *
 * A cast-free widening: `ImportPayloadRow` is structurally `SpeakerImportRow` already. It
 * exists so a caller reads one name for "rows that passed the shape gate" and does not have
 * to know that the two types are the same shape declared twice.
 */
export function payloadRows(payload: ImportPayload): readonly SpeakerImportRow[] {
  return payload.rows
}

/** The catalog's keys, for the drift test. Kept beside the schema it must agree with. */
export const IMPORTABLE_FIELD_KEYS: readonly string[] = IMPORTABLE_FIELDS.map((field) => field.key)
