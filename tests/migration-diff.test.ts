// The schema diff: what gets created, what is left alone, what is reported.
//
// This is the part of scripts/airtable-schema.ts that carries the risk, and the only
// part testable without a base. Three properties are asserted here and nowhere else:
// a second run plans nothing, an existing field is never modified, and a link field
// never lands in pass one.

import { describe, expect, it } from 'vitest'

import { type ExistingTable, linkTargets, planIsEmpty, planSchema } from '@/migrations/diff'
import { SCHEMA } from '@/migrations/schema'
import { autoNumber, checkboxField, link, type TableSpec, text } from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

/** What the Meta API would report for a table built from a spec's declared fields. */
function asExisting(spec: TableSpec, id = `tbl${spec.name}`): ExistingTable {
  return {
    id,
    name: spec.name,
    fields: spec.fields.map((field) => ({ name: field.name, type: field.type })),
  }
}

const alpha: TableSpec = {
  name: 'Alpha',
  fields: [text('name'), checkboxField('done'), link('beta', 'Beta')],
}
const beta: TableSpec = { name: 'Beta', fields: [text('label'), link('alpha', 'Alpha')] }

describe('planSchema on an empty base', () => {
  const plan = planSchema([], [alpha, beta])

  it('creates every declared table', () => {
    expect(plan.createTables.map((table) => table.name)).toEqual(['Alpha', 'Beta'])
  })

  it('leaves every link out of the create, because the target may not exist yet', () => {
    const created = plan.createTables.flatMap((table) => table.fields.map((field) => field.name))
    expect(created).toEqual(['name', 'done', 'label'])
  })

  it('adds every link in pass two instead', () => {
    expect(plan.addFields.map((add) => `${add.tableName}.${add.field.name}`)).toEqual([
      'Alpha.beta',
      'Beta.alpha',
    ])
  })

  it('keeps the declared primary field first in the create', () => {
    expect(plan.createTables.at(0)?.fields.at(0)?.name).toBe('name')
  })
})

describe('planSchema on a base that already matches', () => {
  const existing = [asExisting(alpha), asExisting(beta)]
  const plan = planSchema(existing, [alpha, beta])

  it('plans nothing, which is what makes a second run safe', () => {
    expect(planIsEmpty(plan)).toBe(true)
    expect(plan.createTables).toEqual([])
    expect(plan.addFields).toEqual([])
  })

  it('reports what it matched rather than staying silent', () => {
    expect(plan.matchedTables).toEqual(['Alpha', 'Beta'])
    expect(plan.matchedFields).toBe(5)
  })

  it('finds no mismatch', () => {
    expect(plan.mismatches).toEqual([])
  })
})

describe('planSchema on a partially built base', () => {
  const partial: ExistingTable = {
    id: 'tblA',
    name: 'Alpha',
    fields: [{ name: 'name', type: 'singleLineText' }],
  }
  const plan = planSchema([partial], [alpha, beta])

  it('creates only the missing table', () => {
    expect(plan.createTables.map((table) => table.name)).toEqual(['Beta'])
  })

  it('adds the missing fields of the table that already existed', () => {
    expect(plan.addFields.map((add) => `${add.tableName}.${add.field.name}`)).toEqual([
      'Alpha.done',
      'Alpha.beta',
      'Beta.alpha',
    ])
  })
})

describe('a field whose type disagrees', () => {
  const drifted: ExistingTable = {
    id: 'tblA',
    name: 'Alpha',
    // An organizer made `done` a select instead of a checkbox.
    fields: [
      { name: 'name', type: 'singleLineText' },
      { name: 'done', type: 'singleSelect' },
      { name: 'beta', type: 'multipleRecordLinks' },
    ],
  }
  const plan = planSchema([drifted], [alpha])

  it('is reported, with both types named', () => {
    expect(plan.mismatches).toEqual([
      { tableName: 'Alpha', fieldName: 'done', declared: 'checkbox', actual: 'singleSelect' },
    ])
  })

  it('is not queued for creation, so nothing overwrites it', () => {
    expect(plan.addFields).toEqual([])
    expect(plan.createTables).toEqual([])
  })
})

describe('columns nobody declared', () => {
  const extra: ExistingTable = {
    id: 'tblA',
    name: 'Alpha',
    fields: [
      ...asExisting(alpha).fields,
      // Airtable creates this automatically for the reverse of Beta.alpha.
      { name: 'Beta 2', type: 'multipleRecordLinks' },
      { name: 'organizer notes', type: 'multilineText' },
    ],
  }
  const plan = planSchema([extra], [alpha])

  it('are left entirely alone', () => {
    expect(planIsEmpty(plan)).toBe(true)
    expect(plan.mismatches).toEqual([])
  })
})

describe('a declaration whose first field is a link', () => {
  it('fails at plan time, because the primary field cannot be a link', () => {
    const bad: TableSpec = { name: 'Bad', fields: [link('other', 'Alpha'), text('name')] }
    expect(() => planSchema([], [bad])).toThrow(/primary field/)
  })
})

// SCHEMA rather than MIGRATION_001, and the difference is the point of the folding step.
// Migrations are append-only files, so `Portals` and `ImportRuns` live in 002 while
// `PortalItems` is declared in BOTH: 001 in full, 002 adding one link. The properties
// below are properties of the base every migration to date describes, not of any one file,
// and asserting them against 001 alone would pass while the registry named two tables
// nothing created.
describe('the folded schema', () => {
  const plan = planSchema([], SCHEMA)

  it('declares every table the DAL registry names', () => {
    expect(plan.createTables.map((table) => table.name).sort()).toEqual(
      Object.values(TABLES).slice().sort(),
    )
  })

  it('creates every table with a legal primary field, so pass one cannot fail on one', () => {
    for (const table of plan.createTables) {
      expect(table.fields.length, `${table.name} has no non-link field`).toBeGreaterThan(0)
    }
  })

  it('only links to tables it declares', () => {
    const declared = new Set(SCHEMA.map((table) => table.name))
    for (const target of linkTargets(plan)) {
      expect(declared.has(target), `nothing declares ${target}`).toBe(true)
    }
  })

  it('is fully satisfied by a base built from it, so a re-run is a no-op', () => {
    const built = SCHEMA.map((spec) => asExisting(spec))
    expect(planIsEmpty(planSchema(built, SCHEMA))).toBe(true)
  })

  it('creates PortalItems once, with 001 primary field and 002 portal link', () => {
    // The regression the folding exists to prevent: handing planSchema both declarations
    // unfolded plans a SECOND create of a table the first create is about to make, and
    // only on a fresh base, which is the one base this migration is always run against
    // first.
    const portalItems = plan.createTables.filter((table) => table.name === TABLES.portalItems)
    expect(portalItems).toHaveLength(1)
    expect(portalItems.at(0)?.fields.at(0)?.name).toBe(COL.order)
    expect(
      plan.addFields.some(
        (add) => add.tableName === TABLES.portalItems && add.field.name === COL.portal,
      ),
    ).toBe(true)
  })
})

describe('fields Airtable will not create', () => {
  it('reports an autoNumber instead of queueing it, because the API rejects it', () => {
    // Verified against the real API, not assumed: an autoNumber inside a table create
    // returns 422 UNSUPPORTED_FIELD_TYPE_FOR_CREATE, and so does a standalone field add.
    // Queueing it failed the whole request it rode in, which killed the migration on the
    // fifth of 29 tables and left a half-built base.
    const plan = planSchema(
      [],
      [{ name: 'Submissions', fields: [text('title'), autoNumber('code')] }],
    )

    expect(plan.manual).toEqual([
      { tableName: 'Submissions', fieldName: 'code', type: 'autoNumber' },
    ])
    expect(plan.createTables.at(0)?.fields.map((f) => f.name)).toEqual(['title'])
    expect(plan.addFields).toEqual([])
  })

  it('reports it on an existing table too, so a later run still says it is owed', () => {
    // The base does not match the declaration until a human adds it, and the DAL reads
    // this column, so a run that went quiet about it would be lying.
    const plan = planSchema(
      [{ id: 'tblSub', name: 'Submissions', fields: [{ name: 'title', type: 'singleLineText' }] }],
      [{ name: 'Submissions', fields: [text('title'), autoNumber('code')] }],
    )

    expect(plan.manual).toHaveLength(1)
    expect(plan.addFields).toEqual([])
  })

  it('stops reporting it once the field is really there', () => {
    const plan = planSchema(
      [
        {
          id: 'tblSub',
          name: 'Submissions',
          fields: [
            { name: 'title', type: 'singleLineText' },
            { name: 'code', type: 'autoNumber' },
          ],
        },
      ],
      [{ name: 'Submissions', fields: [text('title'), autoNumber('code')] }],
    )

    expect(plan.manual).toEqual([])
    expect(plan.matchedFields).toBe(2)
  })
})
