// The applier's ordering, against an in-memory base.
//
// The fake below enforces the one rule a real Airtable base enforces and that no
// amount of reading the code proves: a link field cannot be created before its target
// table exists. If `applySchema` ever regresses to a single pass, this fails rather
// than a live base failing halfway through with 15 tables created.
//
// It also pins the property the whole script exists for: applying twice writes nothing
// the second time.

import { describe, expect, it } from 'vitest'

import { MIGRATION_001 } from '@/migrations/001-initial-schema'
import type { ExistingTable } from '@/migrations/diff'
import { checkboxField, link, type TableSpec, text } from '@/migrations/schema-types'
import { applySchema } from '../scripts/lib/apply-schema'
import type { MetaApi, WireField } from '../scripts/lib/meta-api'

type Call = {
  kind: 'list' | 'createTable' | 'createField' | 'updateChoices'
  detail: string
}

/** A field as the base holds it once created: with an id, and with its choices. */
type StoredField = {
  id: string
  name: string
  type: string
  options?: { choices?: { id: string; name: string }[] }
}

function fakeBase(seed: readonly ExistingTable[] = []) {
  const tables = seed.map((table) => ({
    ...table,
    fields: table.fields.map((field) => ({ ...field }) as StoredField),
  }))
  const calls: Call[] = []
  let nextId = 1

  /**
   * What the base stores for a field it has just created.
   *
   * The id and the choices both matter: without an id the diff cannot build a PATCH and
   * silently plans nothing, and without the choices a select created WITH its vocabulary
   * would read back as empty and the second run would try to widen it. Either omission
   * would let the idempotency test pass while proving nothing.
   */
  const born = (field: WireField): StoredField => ({
    id: `fld${String(nextId++)}`,
    name: field.name,
    type: field.type,
    ...(Array.isArray(field.options?.choices)
      ? {
          options: {
            choices: (field.options.choices as { name: string }[]).map((choice, position) => ({
              id: `sel${String(position)}_${choice.name}`,
              name: choice.name,
            })),
          },
        }
      : {}),
  })

  const knownIds = (): Set<string> => new Set(tables.map((table) => table.id))

  /** Every link must point at a table id that exists by the time it is created. */
  const checkLink = (field: WireField, where: string): void => {
    if (field.type !== 'multipleRecordLinks') return
    const target = field.options?.linkedTableId
    if (typeof target !== 'string' || !knownIds().has(target)) {
      throw new Error(`${where}: link "${field.name}" points at a table that does not exist yet`)
    }
  }

  const api: MetaApi = {
    listTables: () => {
      calls.push({ kind: 'list', detail: '' })
      return Promise.resolve(tables.map((table) => ({ ...table, fields: [...table.fields] })))
    },
    createTable: (name, fields) => {
      calls.push({ kind: 'createTable', detail: name })
      if (tables.some((table) => table.name === name)) {
        throw new Error(`${name}: already exists`)
      }
      if (fields.length === 0) throw new Error(`${name}: a table needs at least one field`)
      for (const field of fields) checkLink(field, name)
      const id = `tbl${nextId}`
      nextId += 1
      tables.push({ id, name, fields: fields.map(born) })
      return Promise.resolve(id)
    },
    createField: (tableId, field) => {
      calls.push({ kind: 'createField', detail: `${tableId}.${field.name}` })
      const table = tables.find((candidate) => candidate.id === tableId)
      if (table === undefined) throw new Error(`${tableId}: no such table`)
      if (table.fields.some((existing) => existing.name === field.name)) {
        throw new Error(`${table.name}.${field.name}: already exists`)
      }
      checkLink(field, table.name)
      table.fields.push(born(field))
      return Promise.resolve()
    },

    // Faithful in the one way that decides this feature: a PATCH REPLACES the choice
    // list. This stores what it is given rather than merging, so a caller that forgets to
    // resend an existing choice loses it here exactly as it would against Airtable --
    // except Airtable answers with a 422 when records use it, so refusing is closer still.
    updateFieldChoices: (tableId, fieldId, choices) => {
      calls.push({ kind: 'updateChoices', detail: `${tableId}.${fieldId}` })
      const table = tables.find((candidate) => candidate.id === tableId)
      if (table === undefined) throw new Error(`${tableId}: no such table`)
      const found = table.fields.find((candidate) => candidate.id === fieldId)
      if (found === undefined) throw new Error(`${fieldId}: no such field on ${table.name}`)
      for (const existing of found.options?.choices ?? []) {
        if (!choices.some((choice) => choice.id === existing.id)) {
          throw new Error(`${found.name}: choice "${existing.name}" was dropped by the patch`)
        }
      }
      found.options = {
        choices: choices.map((choice, position) => ({
          id: choice.id ?? `sel${String(position)}_${choice.name}`,
          name: choice.name,
        })),
      }
      return Promise.resolve()
    },
  }

  return { api, calls, snapshot: (): readonly ExistingTable[] => tables }
}

/** A two-table cycle: neither can be created with its link in one pass. */
const cyclic: readonly TableSpec[] = [
  { name: 'Alpha', fields: [text('name'), checkboxField('done'), link('beta', 'Beta')] },
  { name: 'Beta', fields: [text('label'), link('alpha', 'Alpha')] },
]

describe('applySchema on an empty base', () => {
  it('creates the tables first and the links afterwards', async () => {
    const base = fakeBase()
    const summary = await applySchema(base.api, cyclic)

    expect(summary.createdTables).toEqual(['Alpha', 'Beta'])
    expect(summary.createdFields).toBe(2)
    expect(base.calls.map((call) => call.kind)).toEqual([
      'list',
      'createTable',
      'createTable',
      'createField',
      'createField',
    ])
  })

  it('leaves the base matching the declaration', async () => {
    const base = fakeBase()
    await applySchema(base.api, cyclic)
    const alpha = base.snapshot().find((table) => table.name === 'Alpha')
    expect(alpha?.fields.map((field) => field.name)).toEqual(['name', 'done', 'beta'])
  })
})

describe('applySchema run twice', () => {
  it('writes nothing the second time', async () => {
    const base = fakeBase()
    await applySchema(base.api, cyclic)
    const before = base.calls.length

    const second = await applySchema(base.api, cyclic)
    expect(second.createdTables).toEqual([])
    expect(second.createdFields).toBe(0)
    // Exactly one more call: the read it diffs against.
    expect(base.calls.length).toBe(before + 1)
  })
})

describe('applySchema with the real migration', () => {
  it('builds all 29 tables on an empty base and is then idempotent', async () => {
    const base = fakeBase()
    const first = await applySchema(base.api, MIGRATION_001)
    expect(first.createdTables).toHaveLength(MIGRATION_001.length)
    expect(first.createdFields).toBeGreaterThan(0)

    const second = await applySchema(base.api, MIGRATION_001)
    expect(second.createdTables).toEqual([])
    expect(second.createdFields).toBe(0)
    expect(second.plan.mismatches).toEqual([])
  })
})

describe('applySchema --dry-run', () => {
  it('plans without writing', async () => {
    const base = fakeBase()
    const summary = await applySchema(base.api, cyclic, { dryRun: true })

    expect(summary.createdTables).toEqual([])
    expect(summary.plan.createTables).toHaveLength(2)
    expect(base.calls.map((call) => call.kind)).toEqual(['list'])
  })
})

describe('a link to a table nothing declares', () => {
  it('fails before any field is created', async () => {
    const base = fakeBase()
    const broken: readonly TableSpec[] = [
      { name: 'Alpha', fields: [text('name'), link('ghost', 'Ghost')] },
    ]

    await expect(applySchema(base.api, broken)).rejects.toThrow(/Ghost/)
    expect(base.calls.some((call) => call.kind === 'createField')).toBe(false)
  })
})
