// What has to be created to turn the base that exists into the base that is declared.
//
// Pure, and the only part of the schema script that can be tested without a base
// (tests/migration-diff.test.ts). It is also where the two properties that matter
// live, so both are decided here rather than in the applying loop:
//
//   1. Running twice creates nothing the second time. Everything is matched by
//      name, and a name that already exists is never touched.
//   2. A field whose type disagrees is REPORTED, never altered. Destroying an
//      organizer's column because a declaration disagreed about its type is not
//      recoverable, and the Meta API cannot convert one in place anyway.
//
// Link fields are separated out for a reason that has nothing to do with types: a
// link to a table that does not exist yet cannot be created, and this base's link
// graph has cycles (Submissions links Tracks, Files links FileRequestAssignments
// which links Submissions). So no declaration order works, and instead every table
// is created with its scalar columns only and every link field is added afterwards,
// once all 29 tables exist. That is two passes by construction rather than by luck.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type ChoiceAdd, type ExistingTable, planChoices } from '@/migrations/existing-schema'
import {
  type FieldSpec,
  isLink,
  needsManualCreation,
  type TableSpec,
} from '@/migrations/schema-types'

// Re-exported so every caller still reads the base's shape from one place. These moved to
// existing-schema.ts together with the choice planner that needs them, when this file
// crossed the size limit; where they are imported from is not something call sites should
// have to care about.
export type {
  ChoiceAdd,
  ExistingChoice,
  ExistingField,
  ExistingTable,
} from '@/migrations/existing-schema'

/** A table to create, carrying only the fields that can exist before its links do. */
export type TableCreate = { readonly name: string; readonly fields: readonly FieldSpec[] }

export type FieldAdd = { readonly tableName: string; readonly field: FieldSpec }

/**
 * A declared field whose column exists with a different type. Reported and left
 * alone; the human decides whether the declaration or the base is wrong.
 */
export type TypeMismatch = {
  readonly tableName: string
  readonly fieldName: string
  readonly declared: string
  readonly actual: string
}

/** A declared field the Meta API refuses to create, so a human has to add it. */
export type ManualField = {
  readonly tableName: string
  readonly fieldName: string
  readonly type: string
}

export type SchemaPlan = {
  readonly createTables: readonly TableCreate[]
  /** Pass two: every missing field, links included, in table order. */
  readonly addFields: readonly FieldAdd[]
  readonly mismatches: readonly TypeMismatch[]
  /**
   * Fields this migration cannot create, reported so the run finishes and tells you.
   * Verified against the real API: an `autoNumber` in a create returns 422
   * UNSUPPORTED_FIELD_TYPE_FOR_CREATE, and failing there leaves a half-built base.
   */
  readonly manual: readonly ManualField[]
  /**
   * Pass three: selects that exist but are missing declared choices.
   *
   * Its own pass rather than part of `addFields` because it PATCHes a field that already
   * exists rather than creating one, and because it must run AFTER pass two: a select
   * added in the same run arrives with its full choice list and must not then be patched
   * on top of itself.
   */
  readonly choiceAdds: readonly ChoiceAdd[]
  /** Tables that already existed, by name. */
  readonly matchedTables: readonly string[]
  /** Declared fields that already existed with the declared type. */
  readonly matchedFields: number
}

/**
 * A table has to be created with at least one field, and its first field becomes
 * the primary field, which Airtable will not let be a link. Since pass one omits
 * every link, a declaration that opens with one would try to create a table with no
 * columns, or with a different primary field than it reads as having. Both are
 * declaration bugs, so this fails at plan time rather than at the API.
 */
function checkPrimary(spec: TableSpec, scalars: readonly FieldSpec[]): void {
  const first = spec.fields.at(0)
  if (scalars.length > 0 && first !== undefined && scalars.at(0)?.name === first.name) return
  throw new AppError(
    ErrorIds.CFG_SCHEMA_FAIL,
    `${spec.name}: the first declared field must be a non-link, because it becomes the primary field`,
    { table: spec.name, first: first?.name ?? '(none)' },
  )
}

/**
 * A `multipleRecordLinks` field created here makes Airtable create the symmetric
 * field on the other table. Those reverse fields are not declared anywhere and are
 * deliberately ignored: this diff only ever asks "is what I declared present", never
 * "is anything present that I did not declare", so an extra column, whether Airtable
 * or an organizer put it there, is left alone.
 */
function planTableFields(
  spec: TableSpec,
  existing: ExistingTable | undefined,
): {
  create: TableCreate | undefined
  adds: readonly FieldAdd[]
  mismatches: readonly TypeMismatch[]
  manual: readonly ManualField[]
  choices: readonly ChoiceAdd[]
  matched: number
} {
  const byName = new Map((existing?.fields ?? []).map((field) => [field.name, field]))
  const adds: FieldAdd[] = []
  const mismatches: TypeMismatch[] = []
  const manual: ManualField[] = []
  const choices: ChoiceAdd[] = []
  let matched = 0

  for (const field of spec.fields) {
    const found = byName.get(field.name)
    if (found === undefined) {
      // Reported, never queued. Queuing it would fail the whole request it rides in.
      if (needsManualCreation(field)) {
        manual.push({ tableName: spec.name, fieldName: field.name, type: field.type })
        continue
      }
      // A brand new table takes its scalar fields inline; its links wait for pass two.
      if (existing === undefined && !isLink(field)) continue
      adds.push({ tableName: spec.name, field })
      continue
    }
    if (found.type === field.type) {
      matched += 1
      // Matched by name AND type, which used to end the story. A select can match on both
      // and still be missing half its vocabulary, so this is the one case where a matched
      // field still has work to do.
      const widening = planChoices(spec.name, field, found)
      if (widening !== undefined) choices.push(widening)
      continue
    }
    mismatches.push({
      tableName: spec.name,
      fieldName: field.name,
      declared: field.type,
      actual: found.type,
    })
  }

  return { create: planCreate(spec, existing), adds, mismatches, manual, choices, matched }
}

function planCreate(spec: TableSpec, existing: ExistingTable | undefined): TableCreate | undefined {
  if (existing !== undefined) return undefined
  // Manual-only types are excluded from the create for the same reason they are excluded
  // from the adds: one of them in the payload rejects the entire table.
  const scalars = spec.fields.filter((field) => !isLink(field) && !needsManualCreation(field))
  checkPrimary(spec, scalars)
  return { name: spec.name, fields: scalars }
}

/**
 * The plan, from the base as it is to the base as it is declared.
 *
 * `existing` is what the Meta API returned. An empty array is the normal first run,
 * not an error: a fresh base still has whatever table Airtable created it with, and
 * a table this migration does not declare is never touched.
 */
export function planSchema(
  existing: readonly ExistingTable[],
  desired: readonly TableSpec[],
): SchemaPlan {
  const existingByName = new Map(existing.map((table) => [table.name, table]))
  const createTables: TableCreate[] = []
  const addFields: FieldAdd[] = []
  const mismatches: TypeMismatch[] = []
  const manual: ManualField[] = []
  const choiceAdds: ChoiceAdd[] = []
  const matchedTables: string[] = []
  let matchedFields = 0

  for (const spec of desired) {
    const found = existingByName.get(spec.name)
    if (found !== undefined) matchedTables.push(spec.name)

    const result = planTableFields(spec, found)
    if (result.create !== undefined) createTables.push(result.create)
    addFields.push(...result.adds)
    mismatches.push(...result.mismatches)
    manual.push(...result.manual)
    choiceAdds.push(...result.choices)
    matchedFields += result.matched
  }

  return {
    createTables,
    addFields,
    mismatches,
    manual,
    choiceAdds,
    matchedTables,
    matchedFields,
  }
}

/**
 * Nothing to do. Reported rather than inferred from empty arrays at call sites.
 *
 * `choiceAdds` counts, and that is the fix rather than a detail. A base whose only gap was
 * a select short of its vocabulary answered "already matches the declaration. Nothing to
 * create." while the app could not store a value it would send.
 */
export function planIsEmpty(plan: SchemaPlan): boolean {
  return (
    plan.createTables.length === 0 && plan.addFields.length === 0 && plan.choiceAdds.length === 0
  )
}

/**
 * The link targets a plan needs resolved to table ids, deduplicated.
 *
 * Separate from applying so the applier can fail on an unresolvable target BEFORE
 * it has written anything, rather than half way through pass two with a base in a
 * state nobody declared.
 */
export function linkTargets(plan: SchemaPlan): readonly string[] {
  const targets = new Set<string>()
  for (const add of plan.addFields) {
    if (add.field.linkTo !== undefined) targets.add(add.field.linkTo)
  }
  return [...targets]
}
