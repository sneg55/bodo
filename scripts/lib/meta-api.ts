// The Airtable Metadata API: read the base's tables, create a table, create a field.
//
// A separate client from src/services/airtable/client.ts because the URL shape is
// different (`/v0/meta/bases/{baseId}/tables`, not `/v0/{baseId}/{table}`) and the
// responses are schema documents rather than records. What it does NOT do separately
// is rate limiting: it takes the same `Scheduler` the DAL uses, because metadata
// calls draw on the same 5 requests per second per base (BUILD_SPEC 3.1), and a
// second unthrottled client would spend the budget the first one is pacing itself
// against. Backoff, jitter and Retry-After therefore come for free.
//
// Responses are Zod-parsed for the same reason records.ts parses record responses:
// the applier decides what to create from the field list it reads back, so a shape
// it guessed at would be a base half-built from a misread answer.

import { z } from 'zod'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ExistingTable } from '@/migrations/diff'
import type { FieldSpec } from '@/migrations/schema-types'
import type { Scheduler } from '@/services/airtable/scheduler'

const META_ROOT = 'https://api.airtable.com/v0/meta/bases'

const fieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  // Read so the diff can see a select's vocabulary. Optional and loose on purpose: every
  // other field type carries a different `options` shape and none of them is this script's
  // business, so anything that is not a choice list parses as absent rather than failing
  // the whole schema read.
  options: z
    .object({
      choices: z.array(z.object({ id: z.string().min(1), name: z.string() })).optional(),
    })
    .loose()
    .optional(),
})

const tableSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(fieldSchema).default([]),
})

const tablesSchema = z.object({ tables: z.array(tableSchema) })

export type MetaApi = {
  /** Every table in the base, with its fields. One request, no pagination. */
  listTables: () => Promise<readonly ExistingTable[]>
  /** Creates the table and returns its id, which pass two needs for link targets. */
  createTable: (name: string, fields: readonly WireField[]) => Promise<string>
  createField: (tableId: string, field: WireField) => Promise<void>
  /**
   * Widen an existing select's choice list. Pass three.
   *
   * The whole list is sent, not the additions: a PATCH replaces `options.choices`, so a
   * payload carrying only the new names would ask Airtable to DELETE every existing
   * choice, and it refuses that when records use them. Each surviving choice therefore
   * has to be sent with its own `id` — a choice sent by name alone reads as a new one,
   * which is how you end up with two options spelled identically.
   */
  updateFieldChoices: (
    tableId: string,
    fieldId: string,
    choices: readonly ChoicePatch[],
  ) => Promise<void>
}

/** An existing choice keeps its id; a new one has a name and no id. */
export type ChoicePatch = { readonly id?: string; readonly name: string }

/** A field as the API wants it: no `linkTo`, an id in `options.linkedTableId`. */
export type WireField = {
  name: string
  type: string
  options?: Record<string, unknown>
}

/**
 * A declared field turned into the wire shape.
 *
 * This is where a link's target table NAME becomes an id, and where an unresolvable
 * target is an error rather than a field created pointing at nothing: Airtable would
 * reject it anyway, but with a message about `options` instead of about the table
 * whose name is wrong.
 */
export function toWireField(field: FieldSpec, tableIds: ReadonlyMap<string, string>): WireField {
  if (field.linkTo === undefined) {
    return {
      name: field.name,
      type: field.type,
      ...(field.options ? { options: field.options } : {}),
    }
  }
  const linkedTableId = tableIds.get(field.linkTo)
  if (linkedTableId === undefined) {
    throw new AppError(
      ErrorIds.CFG_SCHEMA_FAIL,
      `field "${field.name}" links to "${field.linkTo}", which is not a table in this base`,
      { field: field.name, linkTo: field.linkTo },
    )
  }
  return { name: field.name, type: field.type, options: { linkedTableId } }
}

export function createMetaApi(config: {
  baseId: string
  token: string
  scheduler: Scheduler
}): MetaApi {
  const headers = {
    authorization: `Bearer ${config.token}`,
    'content-type': 'application/json',
  }
  const root = `${META_ROOT}/${config.baseId}/tables`

  async function send(url: string, init: RequestInit, what: string): Promise<unknown> {
    const response = await config.scheduler.fetch(url, { ...init, headers, cache: 'no-store' })
    if (!response.ok) {
      // Airtable puts the actionable part in the body: which field, which option.
      const body = await response.text().catch(() => '')
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `${what}: ${response.status} ${body.slice(0, 300)}`,
        {
          status: response.status,
          what,
        },
      )
    }
    return await response.json()
  }

  function parse<T>(body: unknown, schema: z.ZodType<T>, what: string): T {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new AppError(ErrorIds.NET_BAD_SHAPE, `${what}: response did not parse`, {
        what,
        issues: parsed.error.issues.slice(0, 3).map((issue) => issue.message),
      })
    }
    return parsed.data
  }

  return {
    listTables: async () => {
      const body = await send(root, { method: 'GET' }, 'reading the base schema')
      return parse(body, tablesSchema, 'reading the base schema').tables
    },

    createTable: async (name, fields) => {
      const body = await send(
        root,
        { method: 'POST', body: JSON.stringify({ name, fields }) },
        `creating table ${name}`,
      )
      return parse(body, tableSchema, `creating table ${name}`).id
    },

    createField: async (tableId, field) => {
      await send(
        `${root}/${encodeURIComponent(tableId)}/fields`,
        { method: 'POST', body: JSON.stringify(field) },
        `creating field ${field.name}`,
      )
    },

    updateFieldChoices: async (tableId, fieldId, choices) => {
      await send(
        `${root}/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`,
        { method: 'PATCH', body: JSON.stringify({ options: { choices } }) },
        `adding choices to field ${fieldId}`,
      )
    },
  }
}
