// "Make sure these rows exist", once per table.
//
// Every seed step is written in terms of this and nothing else, which is what keeps
// the seed idempotent without each step remembering to check first.
//
// Writes go through the DAL's own client (src/services/airtable/client.ts), not a
// fetch loop: that client already chunks a create at Airtable's 10-record ceiling and
// already routes every request through the per-base scheduler, so the rate cap,
// exponential backoff, jitter and Retry-After are the same ones the app runs under. A
// hand-rolled loop here would be a second, untested implementation of BUILD_SPEC 3.1
// that gets to discover 429 handling on its own.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { AirtableClient } from '@/services/airtable/client'
import type { FieldSet } from '@/services/airtable/records'
import { indexByKey, keyFromValues, keyOfFields, keyOn, partitionRows } from './keys'

export type Ensured = {
  /** Key to record id, covering rows that already existed and rows just created. */
  readonly ids: ReadonlyMap<string, string>
  readonly created: number
  readonly present: number
}

export type Ensure = (
  table: string,
  keyFields: readonly string[],
  rows: readonly FieldSet[],
) => Promise<Ensured>

export type EnsureDeps = {
  client: AirtableClient
  /** Progress, one line per table. Absent means silent, which is what tests want. */
  report?: (line: string) => void
}

/**
 * What every step is handed. `ensure` covers creating rows; `client` is there for the
 * one thing creating cannot express, which is scheduling an existing submission.
 */
export type SeedContext = { readonly ensure: Ensure; readonly client: AirtableClient }

export function makeContext(deps: EnsureDeps): SeedContext {
  return { ensure: makeEnsure(deps), client: deps.client }
}

export function makeEnsure(deps: EnsureDeps): Ensure {
  return async (table, keyFields, rows) => {
    const key = keyOn(keyFields)

    // The whole table, paginated to completion by the client. A conference base is
    // small enough that reading it beats a filterByFormula per row, and a formula
    // cannot match on a linked-record field anyway (see formula.ts), which is what
    // most of the natural keys in section 3 are made of.
    const existing = await deps.client.listAll(table)
    const found = indexByKey(existing, key)
    const split = partitionRows(new Set(found.keys()), rows, key)

    const ids = new Map(found)
    if (split.create.length > 0) {
      const written = await deps.client.createRecords(table, split.create)
      // Zipped by position rather than re-keyed off the response, because Airtable
      // echoes a created record back through its own field formatting and a key
      // derived from the echo could differ from the key derived from the request.
      for (const [index, record] of written.entries()) {
        const fields = split.create.at(index)
        if (fields !== undefined) ids.set(keyOfFields(key, fields), record.id)
      }
    }

    deps.report?.(
      `  ${table}: created ${split.create.length}, already present ${split.present}` +
        (split.duplicates > 0 ? `, duplicate declarations skipped ${split.duplicates}` : ''),
    )

    return { ids, created: split.create.length, present: split.present }
  }
}

/**
 * One id by key, or a failure naming what was missing.
 *
 * Every step after the first depends on ids the step before produced, and a silent
 * `undefined` there becomes a link field written as `[undefined]`, which Airtable
 * accepts the shape of and stores as empty. That is a submission with no event.
 */
export function idOf(ensured: Ensured, key: string, what: string): string {
  const id = ensured.ids.get(key)
  if (id === undefined) {
    throw new AppError(
      ErrorIds.DATA_MISSING_LINK,
      `seed: no ${what} for key "${key}". The step that creates it did not run.`,
      { what, key },
    )
  }
  return id
}

/**
 * The same lookup by key column VALUES, in the order the table was ensured with, so a
 * caller never spells a composite key itself. `idFor(tracks, [link(eventId), 'Infra'])`
 * rather than a hand-built string with a JSON array in the middle of it.
 */
export function idFor(ensured: Ensured, values: readonly unknown[], what: string): string {
  return idOf(ensured, keyFromValues(values), what)
}
