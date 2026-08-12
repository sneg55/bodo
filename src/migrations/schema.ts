// Every migration, folded into the one declaration the schema script applies.
//
// Migrations are append-only files (README.md), so the same table legitimately appears in
// more than one of them: 002 adds a single link to `PortalItems`, which 001 already
// declares in full. Handing `planSchema` both declarations unchanged would be wrong on a
// FRESH base and only there, which is the worst place for it to be wrong: `planSchema`
// walks `desired` in order against one snapshot of what exists, so the second `PortalItems`
// spec would see the same empty base as the first and plan a second create of a table the
// first create is about to make.
//
// Folding fixes that without either migration knowing about the other, and it fixes a
// second thing on the way: a later migration that adds only a link to an existing table
// would fail `checkPrimary`, which requires the first declared field to be a non-link. The
// merged spec keeps 001's primary field, so 002 does not have to restate it.

import { MIGRATION_001 } from '@/migrations/001-initial-schema'
import { MIGRATION_002 } from '@/migrations/002-portals-and-imports'
import type { FieldSpec, TableSpec } from '@/migrations/schema-types'

/**
 * One spec per table name, fields in first-declared order.
 *
 * FIRST wins on a repeated field name, deliberately. A later migration restating a column
 * is a no-op here, and the alternative would be a redefinition: `planSchema` reports a type
 * disagreement rather than altering a column, so letting a later file win would move that
 * report from "your declaration and the base disagree" to "your declarations disagree with
 * each other", which is a worse error at a later time. A migration that genuinely needs to
 * change a type has to do it in Airtable and say so, which is the rule diff.ts already
 * enforces against the base.
 *
 * Table ORDER is first-appearance, and it does not matter: `planSchema` creates every table
 * with its scalar columns first and adds every link afterwards, so the graph's cycles need
 * no ordering at all.
 */
export function mergeTableSpecs(specs: readonly TableSpec[]): readonly TableSpec[] {
  const byName = new Map<string, FieldSpec[]>()
  const order: string[] = []

  for (const spec of specs) {
    const existing = byName.get(spec.name)
    if (existing === undefined) {
      byName.set(spec.name, [...spec.fields])
      order.push(spec.name)
      continue
    }
    const seen = new Set(existing.map((field) => field.name))
    for (const field of spec.fields) {
      if (seen.has(field.name)) continue
      seen.add(field.name)
      existing.push(field)
    }
  }

  return order.map((name) => ({ name, fields: byName.get(name) ?? [] }))
}

/** The base as every migration to date declares it. What the schema script applies. */
export const SCHEMA: readonly TableSpec[] = mergeTableSpecs([...MIGRATION_001, ...MIGRATION_002])
