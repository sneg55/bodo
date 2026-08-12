// The Airtable wire format, validated, plus the typed readers every mapper uses.
//
// Two jobs. It is the Zod boundary: nothing reaches a mapper until the response
// has been checked into `{ id, fields }` shape (BUILD_SPEC 3.1). And it is the
// only place a field is looked up by name, which is why a record's fields are
// copied into a Map first. Indexing a plain object built from network JSON with a
// variable key is what `security/detect-object-injection` is warning about, and a
// field literally named `__proto__` would otherwise read off the prototype chain.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'

export type FieldSet = Readonly<Record<string, unknown>>
export type AirtableRecord = { id: string; fields: FieldSet }

const recordSchema = z.object({
  id: z.string().min(1),
  createdTime: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
})

const listSchema = z.object({
  records: z.array(recordSchema),
  offset: z.string().optional(),
})

const batchSchema = z.object({ records: z.array(recordSchema) })

export type ListPage = { records: readonly AirtableRecord[]; offset?: string }

function badShape(table: string, error: z.ZodError): AppError {
  return new AppError(ErrorIds.NET_BAD_SHAPE, `airtable response for ${table} did not parse`, {
    table,
    issues: error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  })
}

export function parseListPage(body: unknown, table: string): ListPage {
  const parsed = listSchema.safeParse(body)
  if (!parsed.success) throw badShape(table, parsed.error)
  return parsed.data
}

/** Create, update and upsert all answer with `{ records: [...] }`. */
export function parseBatch(body: unknown, table: string): readonly AirtableRecord[] {
  const parsed = batchSchema.safeParse(body)
  if (!parsed.success) throw badShape(table, parsed.error)
  return parsed.data.records
}

export function parseRecord(body: unknown, table: string): AirtableRecord {
  const parsed = recordSchema.safeParse(body)
  if (!parsed.success) throw badShape(table, parsed.error)
  return parsed.data
}

/** A record with its fields addressable by name, and enough identity for errors. */
export type RecordView = {
  id: string
  table: string
  get: (field: string) => unknown
}

export function view(table: string, record: AirtableRecord): RecordView {
  const fields = new Map(Object.entries(record.fields))
  return { id: record.id, table, get: (field) => fields.get(field) }
}

/** Every read failure below names the record, because that is what a fix needs. */
export function shapeError(source: RecordView, field: string, detail: string): AppError {
  return new AppError(
    ErrorIds.DATA_SHAPE_INVALID,
    `${source.table} record ${source.id}: field "${field}" ${detail}`,
    { recordId: source.id, table: source.table, field },
  )
}

// Airtable omits a field entirely when it is empty, so "absent" and "blank" are
// the same thing on the wire and both mean undefined here.

export function optionalText(source: RecordView, field: string): string | undefined {
  const raw = source.get(field)
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw shapeError(source, field, 'is not text')
  return raw
}

export function text(source: RecordView, field: string): string {
  const value = optionalText(source, field)
  if (value === undefined) throw shapeError(source, field, 'is required but empty')
  return value
}

export function optionalNumber(source: RecordView, field: string): number | undefined {
  const raw = source.get(field)
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw shapeError(source, field, 'is not a finite number')
  }
  return raw
}

export function numberOr(source: RecordView, field: string, fallback: number): number {
  return optionalNumber(source, field) ?? fallback
}

/** An unchecked Airtable checkbox is absent, not `false`. */
export function checkbox(source: RecordView, field: string): boolean {
  const raw = source.get(field)
  if (raw === undefined || raw === null) return false
  if (typeof raw !== 'boolean') throw shapeError(source, field, 'is not a checkbox')
  return raw
}

/** A link field always arrives as an array of record ids, even for one link. */
export function linkIds(source: RecordView, field: string): readonly string[] {
  const raw = source.get(field)
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw shapeError(source, field, 'is not a link array')
  return raw.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw shapeError(source, field, `entry ${index} is not a record id`)
    }
    return entry
  })
}

/** A single link collapses to a scalar id: the array is Airtable's, not ours. */
export function optionalLink(source: RecordView, field: string): string | undefined {
  return linkIds(source, field).at(0)
}

export function requiredLink(source: RecordView, field: string): string {
  const id = optionalLink(source, field)
  if (id === undefined) throw shapeError(source, field, 'is a required link but empty')
  return id
}

export function optionalChoice<T extends string>(
  source: RecordView,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const raw = optionalText(source, field)
  if (raw === undefined) return undefined
  const match = allowed.find((option) => option === raw)
  if (match === undefined) {
    throw shapeError(source, field, `is "${raw}", which is not one of ${allowed.join(', ')}`)
  }
  return match
}

/**
 * A select with a default. The fallback covers the row an organizer created in
 * Airtable directly and left blank, which must not take a whole list down.
 */
export function choiceOr<T extends string>(
  source: RecordView,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return optionalChoice(source, field, allowed) ?? fallback
}

export function requiredChoice<T extends string>(
  source: RecordView,
  field: string,
  allowed: readonly T[],
): T {
  const value = optionalChoice(source, field, allowed)
  if (value === undefined) throw shapeError(source, field, 'is a required select but empty')
  return value
}

/**
 * A JSON blob column: parsed, then validated against the shape the app expects.
 *
 * Both failures are `DATA_SHAPE_INVALID` naming the record, because both mean the
 * same thing to whoever has to fix it: this row's blob does not match the schema
 * the reader was written against. Returning the fallback instead would hand the
 * UI a form with no fields and no explanation.
 */
export function jsonBlob<T>(
  source: RecordView,
  field: string,
  schema: z.ZodType<T>,
  fallback: T,
): T {
  const raw = source.get(field)
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw !== 'string') throw shapeError(source, field, 'is not a JSON string')

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw shapeError(source, field, 'is not valid JSON')
  }

  const parsed = schema.safeParse(decoded)
  if (!parsed.success) {
    const first = parsed.error.issues.at(0)
    const where = first === undefined ? 'unknown' : `${first.path.join('.')}: ${first.message}`
    throw shapeError(source, field, `failed validation (${where})`)
  }
  return parsed.data
}

/**
 * The one record a single-row create returned.
 *
 * `createRecords` is typed as returning an array of any length, because it is also
 * the batch path, so every caller that creates one thing has to answer what an empty
 * array means. It means the write did not happen, and the id such a caller is about to
 * hand back would be a link to nothing.
 */
export function onlyRecord(records: readonly AirtableRecord[], table: string): AirtableRecord {
  const record = records.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, `${table}: write returned no record`, { table })
  }
  return record
}

/**
 * A recipient list stored as one text column (`Forms.adminAlertOnNew`). Commas,
 * semicolons and newlines all appear in practice because a human typed it.
 */
export function emailList(source: RecordView, field: string): readonly string[] {
  const raw = optionalText(source, field)
  if (raw === undefined) return []
  return raw
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}
