// Folding the migrations into one declaration. src/migrations/schema.ts.
//
// This is tested because its failure mode is confined to a FRESH base, which is the one base
// nobody runs the migration against twice. `planSchema` walks the desired tables in order
// against a single snapshot of what exists, so two declarations of `PortalItems` would both
// see the same empty base and both plan a create: the second one 422s on a table the first
// has just made, and it does so half way through building a 29-table base, leaving the rest
// of the schema unapplied. Against an already-migrated base the same bug is invisible,
// because the table exists by the time either declaration is read.
//
// The second thing it protects is the primary field. `checkPrimary` in diff.ts requires the
// first declared field to be a non-link, and migration 002 declares `PortalItems` as nothing
// but a link, so the fold has to keep 001's `order` in front of it. Without that, adding one
// column to an existing table would fail validation on a table it was not changing.

import { describe, expect, it } from 'vitest'

import { MIGRATION_001 } from '@/migrations/001-initial-schema'
import { MIGRATION_002 } from '@/migrations/002-portals-and-imports'
import { mergeTableSpecs, SCHEMA } from '@/migrations/schema'
import { link, numberField, text } from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

function fieldNames(
  table: string,
  specs: readonly { name: string; fields: readonly { name: string }[] }[],
) {
  return specs.find((spec) => spec.name === table)?.fields.map((field) => field.name)
}

describe('mergeTableSpecs', () => {
  it('folds a repeated table name into one spec', () => {
    const merged = mergeTableSpecs([
      { name: 'PortalItems', fields: [numberField('order'), text('itemType')] },
      { name: 'PortalItems', fields: [link('portal', 'Portals')] },
    ])

    // One entry, not two. Two would be two CREATE plans against the same empty base.
    expect(merged).toHaveLength(1)
    expect(fieldNames('PortalItems', merged)).toEqual(['order', 'itemType', 'portal'])
  })

  it('keeps first-declared field order, so the primary field survives a later addition', () => {
    const merged = mergeTableSpecs([
      { name: 'PortalItems', fields: [numberField('order')] },
      { name: 'PortalItems', fields: [link('portal', 'Portals'), text('itemType')] },
    ])

    // `checkPrimary` reads `fields[0]` and rejects a link there. A later migration that adds
    // only a link must not be able to push itself in front of the table's primary column.
    expect(fieldNames('PortalItems', merged)?.at(0)).toBe('order')
  })

  it('treats a repeated field name as a no-op, first declaration winning', () => {
    const merged = mergeTableSpecs([
      { name: 'Portals', fields: [text('name'), numberField('order')] },
      { name: 'Portals', fields: [numberField('name'), text('kind')] },
    ])

    // FIRST wins, so the restated `name` keeps its original type rather than being
    // redefined. Letting the later file win would turn "your declaration and the base
    // disagree", which diff.ts reports against a real base, into "your declarations disagree
    // with each other", which is a worse error discovered later.
    const portals = merged.find((spec) => spec.name === 'Portals')
    expect(portals?.fields.map((field) => field.name)).toEqual(['name', 'order', 'kind'])
    expect(portals?.fields.at(0)?.type).toBe('singleLineText')
  })

  it('preserves table order by first appearance and leaves single-declared tables alone', () => {
    const merged = mergeTableSpecs([
      { name: 'Portals', fields: [text('name')] },
      { name: 'ImportRuns', fields: [text('sourceRef')] },
      { name: 'Portals', fields: [text('kind')] },
    ])

    // Ordering does not affect what is applied (planSchema creates every table's scalars
    // first and every link afterwards), so this asserts stability rather than a requirement:
    // a fold that reordered tables would make the migration's own report unreadable.
    expect(merged.map((spec) => spec.name)).toEqual(['Portals', 'ImportRuns'])
  })
})

describe('the merged PortalItems spec, as the two real migrations declare it', () => {
  it('appears once in SCHEMA even though two migrations declare it', () => {
    expect(SCHEMA.filter((spec) => spec.name === TABLES.portalItems)).toHaveLength(1)
  })

  it('keeps `order` as its primary field while gaining `portal`', () => {
    const fields = fieldNames(TABLES.portalItems, SCHEMA)

    // 001 leads with `order`; 002 declares nothing but the link. Both facts are asserted
    // here rather than assumed, because the fold is only correct if both hold.
    expect(fieldNames(TABLES.portalItems, MIGRATION_001)?.at(0)).toBe(COL.order)
    expect(fieldNames(TABLES.portalItems, MIGRATION_002)).toEqual([COL.portal])

    expect(fields?.at(0)).toBe(COL.order)
    expect(fields).toContain(COL.portal)
    // The link lands at the END, after everything 001 declared, which is what keeps the
    // primary field where `checkPrimary` needs it.
    expect(fields?.at(-1)).toBe(COL.portal)
  })

  it('carries the Portals table 002 adds, with a non-link primary field', () => {
    const portals = SCHEMA.find((spec) => spec.name === TABLES.portals)

    expect(portals?.fields.at(0)?.name).toBe(COL.name)
    expect(portals?.fields.at(0)?.type).toBe('singleLineText')
    // `order` could not lead: a base whose primary column reads 0, 1, 2 is unreadable in
    // Airtable itself, and the list screen is the only place a portal is identified.
    expect(portals?.fields.map((field) => field.name)).toContain(COL.filterJson)
  })
})
