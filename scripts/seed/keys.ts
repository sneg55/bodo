// How the seed decides a row already exists. Pure, and unit tested
// (tests/seed-keys.test.ts), because this is the whole of its idempotency.
//
// Airtable has no unique index, so "already seeded" cannot be a constraint and has
// to be a lookup: read the table, build a key per row, and create only the keys that
// are absent. The one property that makes it safe is that the SAME key function runs
// over the record read back from Airtable and over the field set about to be written.
// A second implementation for the write side is how a re-run doubles a table: the
// two would agree on twelve rows and disagree on the thirteenth.
//
// So a desired row is keyed by pretending it is already a record, which is what
// `keyOfFields` does. There is no separate write-side path to drift.

import type { AirtableRecord, FieldSet } from '@/services/airtable/records'
import { view } from '@/services/airtable/records'

/** A stable identity for one row, derived from columns that a human sets. */
export type KeyFn = (record: AirtableRecord) => string

/**
 * One value, flattened to a string.
 *
 * A link field arrives as an array of record ids and is sorted before joining, so a
 * multi-link key does not depend on the order Airtable happened to return. A missing
 * field is the empty string rather than an error: an optional column left blank is a
 * legitimate part of a key, which is how a contact task assignment (no submission)
 * stays distinct from a submission-scoped one.
 */
function flatten(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Link arrays, and anything else Airtable returns for a field a key names. JSON
  // rather than String(), because every non-primitive stringifies to [object Object]
  // and every row would then share a key.
  return JSON.stringify(Array.isArray(value) ? [...(value as unknown[])].sort() : value)
}

/**
 * Key on these columns, in this order.
 *
 * Works for text, selects and links alike, which is deliberate: the natural keys in
 * section 3 mix them (`SubmissionParticipants` is unique on two links plus a select),
 * and a separate builder per column type is a second place for the same rule to live.
 */
export function keyOn(fields: readonly string[]): KeyFn {
  return (record) => {
    const source = view('seed', record)
    return fields.map((field) => flatten(source.get(field))).join('|')
  }
}

/** The key of a row that does not exist yet. Same function, no record id needed. */
export function keyOfFields(key: KeyFn, fields: FieldSet): string {
  return key({ id: '', fields })
}

/**
 * The key a row would have, given its key column values in the order `keyOn` was
 * built with.
 *
 * This exists so a caller looking a row up by its natural key never has to know how a
 * key is spelled. Before it, one step built the string by hand and had a
 * `JSON.stringify([eventId])` in the middle of it, which is a private detail of
 * `flatten` sitting in a call site that would not notice when it changed.
 */
export function keyFromValues(values: readonly unknown[]): string {
  return values.map(flatten).join('|')
}

export type Partitioned = {
  /** In input order, deduplicated. */
  readonly create: readonly FieldSet[]
  /** Rows whose key was already present in the base. */
  readonly present: number
  /** Rows dropped because an earlier row in the same batch carried the same key. */
  readonly duplicates: number
}

/**
 * Split desired rows into what has to be created and what is already there.
 *
 * Deduplicating WITHIN the input matters as much as checking against the base. Two
 * declarations that resolve to the same key (the same speaker listed twice on one
 * submission, say) would otherwise be created twice on the first run and then read as
 * present on the second, so the base would end up with a duplicate that a re-run
 * never notices and never fixes.
 */
export function partitionRows(
  existing: ReadonlySet<string>,
  rows: readonly FieldSet[],
  key: KeyFn,
): Partitioned {
  const create: FieldSet[] = []
  const seen = new Set<string>()
  let present = 0
  let duplicates = 0

  for (const fields of rows) {
    const rowKey = keyOfFields(key, fields)
    if (existing.has(rowKey)) {
      present += 1
      continue
    }
    if (seen.has(rowKey)) {
      duplicates += 1
      continue
    }
    seen.add(rowKey)
    create.push(fields)
  }

  return { create, present, duplicates }
}

/** Key to record id for rows already in the base. */
export function indexByKey(
  records: readonly AirtableRecord[],
  key: KeyFn,
): ReadonlyMap<string, string> {
  return new Map(records.map((record) => [key(record), record.id]))
}
