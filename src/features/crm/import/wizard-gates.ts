// The import wizard's gate: its step list, and what stops each step being left.
//
// Split out of `wizard-state.ts` when that file passed the 300-line ceiling, along the seam
// the ceiling was pointing at: everything here answers "may the organizer move on", and
// everything left there answers "what does this file turn into". The dependency runs one way,
// this module onto that one, because a blocker is a sentence about a mapped row.
//
// Pure, and unit tested in `tests/crm-import-wizard-state.test.ts` for the reason the whole
// repo splits rules out of components: this decides whether a wizard traps somebody on a valid
// step, which is expensive to find through the UI and cheap to assert here.

import type { WizardStep } from '@/components/primitives/step-wizard'
import { IMPORT_ROW_CAP } from '@/features/crm/import/fields'
import { missingRequiredFields } from '@/features/crm/import/map-row'
import {
  type ColumnChoice,
  type MappedRows,
  mappingFromChoices,
} from '@/features/crm/import/wizard-state'

export const IMPORT_STEPS: readonly WizardStep[] = [
  { id: 'upload', title: 'Upload' },
  { id: 'map', title: 'Map columns' },
  { id: 'preview', title: 'Preview' },
  { id: 'commit', title: 'Commit' },
]

/**
 * The biggest file the upload step will read.
 *
 * A guard on the BROWSER's memory, checked before `File.text()` is called, and unrelated to
 * the row cap: `IMPORT_ROW_CAP` bounds what one Workers request will write, this bounds what
 * one tab will hold. 2 MB is roughly 20,000 rows of ordinary speaker data, so every file the
 * row cap admits is far inside it, and a file that trips this one is a mistake (a whole
 * database export, a zip renamed) rather than a big import.
 */
export const MAX_UPLOAD_BYTES = 2_000_000

/** The complaint about an oversized file, or `undefined` when there is none. */
export function uploadSizeMessage(bytes: number): string | undefined {
  if (bytes <= MAX_UPLOAD_BYTES) return undefined
  const mb = (bytes / 1_000_000).toFixed(1)
  return `That file is ${mb} MB. Export just the speaker columns, or split it, and keep it under ${String(MAX_UPLOAD_BYTES / 1_000_000)} MB.`
}

/** What the upload step will not let the organizer leave with. */
export function uploadBlockers(
  parsed: { readonly rowCount: number } | undefined,
): readonly string[] {
  if (parsed === undefined) return ['Upload a file to import.']
  if (parsed.rowCount === 0) return ['That file has a header row and no data rows.']
  if (parsed.rowCount > IMPORT_ROW_CAP) {
    return [
      `That file has ${parsed.rowCount} rows and the import accepts ${IMPORT_ROW_CAP} at a time. Split it and upload the parts.`,
    ]
  }
  return []
}

/**
 * What the mapping step will not let the organizer leave with.
 *
 * Only the required field, which is `email`: it is the identity every row is matched and
 * deduplicated on, so a file with no email column has nothing to import. Everything else is
 * genuinely optional, and a file that maps only an address is a legitimate way to add a
 * roster of people whose details the portal will collect.
 */
export function mapBlockers(choices: ReadonlyMap<string, ColumnChoice>): readonly string[] {
  const missing = missingRequiredFields(mappingFromChoices(choices))
  if (missing.length === 0) return []
  return [`Map a column to ${missing.map((field) => field.label).join(', ')} to continue.`]
}

/** What the preview step will not let the organizer commit. */
export function previewBlockers(mapped: MappedRows): readonly string[] {
  if (mapped.rows.length === 0) return ['No row in this file has a usable email address.']
  return []
}

/** Everything the three per-step blocker rules above need, and nothing else. */
export type ImportWizardState = {
  readonly parsed: { readonly rowCount: number } | undefined
  readonly choices: ReadonlyMap<string, ColumnChoice>
  readonly mapped: MappedRows
}

/**
 * Why `step` cannot be left yet. Empty means it can.
 *
 * One entry point over the three rules above, so the sentence printed beside Continue and the
 * set that decides whether Continue is live are computed from the same call. They used to be
 * two expressions in the component, which is how a wizard ends up drawing an explanation next
 * to a live button, or greying a button with nothing to say.
 */
export function stepBlockers(step: string, state: ImportWizardState): readonly string[] {
  if (step === 'upload') return uploadBlockers(state.parsed)
  if (step === 'map') return mapBlockers(state.choices)
  if (step === 'preview') return previewBlockers(state.mapped)
  // Commit gates nothing: its control is the import itself, and what stops it is the receipt
  // already in hand, which is the component's state rather than a rule about the file.
  return []
}

/**
 * The step ids `StepWizard`'s gate considers complete, which is exactly "has no blockers".
 *
 * A `gated` wizard, not a `free` one, because this CREATES: a mapping chosen against a file
 * that was then replaced is not a step anyone should be able to walk back into from three
 * steps ahead. `canReachStep` reads this set, so a step edited back into an invalid state
 * closes the steps after it again, which is the behaviour the rail draws.
 */
export function completedImportSteps(state: ImportWizardState): ReadonlySet<string> {
  return new Set(
    IMPORT_STEPS.filter((step) => stepBlockers(step.id, state).length === 0).map((step) => step.id),
  )
}
