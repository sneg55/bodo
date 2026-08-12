// The two passes, in order, against whatever MetaApi it is handed.
//
// Kept separate from the CLI so the ordering can be tested against an in-memory
// base (tests/migration-apply.test.ts). The ordering is the part that breaks: a
// link field cannot be created before its target table exists, and this base's link
// graph has cycles, so the guarantee has to come from the passes rather than from a
// declaration order somebody has to maintain.
//
//   Pass one creates each missing table with its scalar columns only.
//   Then every link target is resolved to a table id, and an unresolvable one fails
//   HERE, before pass two has written anything.
//   Pass two adds every missing field, links included, to a base where all 29
//   tables already exist.
//
// Nothing is ever deleted or altered. A field that exists with a different type is
// carried out in `plan.mismatches` for the caller to report.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { linkTargets, planSchema, type SchemaPlan } from '@/migrations/diff'
import { choicePatchFor } from '@/migrations/existing-schema'
import type { TableSpec } from '@/migrations/schema-types'
import { type MetaApi, toWireField } from './meta-api'

export type ApplySummary = {
  readonly plan: SchemaPlan
  readonly createdTables: readonly string[]
  readonly createdFields: number
  /** Pass three: selects widened in place. Counted separately; nothing was created. */
  readonly widenedFields: number
}

/** Table name to table id, for the base as it stands right now. */
type TableIds = Map<string, string>

async function createMissingTables(
  api: MetaApi,
  plan: SchemaPlan,
  tableIds: TableIds,
): Promise<readonly string[]> {
  const created: string[] = []
  for (const table of plan.createTables) {
    const fields = table.fields.map((field) => toWireField(field, tableIds))
    tableIds.set(table.name, await api.createTable(table.name, fields))
    created.push(table.name)
  }
  return created
}

/**
 * Every link target resolves, checked before pass two starts writing.
 *
 * A missing target here means a declaration points at a table nothing declares, which
 * is a typo in `linkTo`. Failing now leaves the base with the tables pass one created
 * and no half-added link graph, and a re-run picks up where this left off.
 */
function checkLinkTargets(plan: SchemaPlan, tableIds: TableIds): void {
  const unresolved = linkTargets(plan).filter((target) => !tableIds.has(target))
  if (unresolved.length === 0) return
  throw new AppError(
    ErrorIds.CFG_SCHEMA_FAIL,
    `these link targets are not tables in this base: ${unresolved.join(', ')}`,
    { unresolved: unresolved.length },
  )
}

async function addMissingFields(
  api: MetaApi,
  plan: SchemaPlan,
  tableIds: TableIds,
): Promise<number> {
  let added = 0
  for (const add of plan.addFields) {
    const tableId = tableIds.get(add.tableName)
    if (tableId === undefined) {
      throw new AppError(
        ErrorIds.CFG_SCHEMA_FAIL,
        `${add.tableName}: table id unknown after pass one`,
        {
          table: add.tableName,
        },
      )
    }
    await api.createField(tableId, toWireField(add.field, tableIds))
    added += 1
  }
  return added
}

/**
 * Pass three: widen the selects that exist but are short of declared choices.
 *
 * AFTER pass two, and that ordering is load-bearing rather than tidy. A select created in
 * this same run arrives with its full choice list in the create payload, and `planSchema`
 * built the plan from the base as it was BEFORE either pass ran, so a field in `addFields`
 * is never also in `choiceAdds`. Running this first would PATCH a field that does not
 * exist yet.
 *
 * Each PATCH sends the whole list, existing ids intact -- see `choicePatchFor`. Nothing is
 * removed or renamed, so a re-run after a partial failure resends the same union and
 * settles at the same place.
 */
async function widenChoiceFields(
  api: MetaApi,
  plan: SchemaPlan,
  tableIds: TableIds,
): Promise<number> {
  let widened = 0
  for (const add of plan.choiceAdds) {
    const tableId = tableIds.get(add.tableName)
    if (tableId === undefined) {
      throw new AppError(ErrorIds.CFG_SCHEMA_FAIL, `${add.tableName}: table id unknown`, {
        table: add.tableName,
      })
    }
    await api.updateFieldChoices(tableId, add.fieldId, choicePatchFor(add))
    widened += 1
  }
  return widened
}

/**
 * Read, diff, create. Idempotent: a second run reads the base back, finds every
 * declared name present, and plans nothing.
 *
 * `dryRun` stops after the diff, which is the only way to see what a run would do to
 * a base somebody else is using without doing it.
 */
export async function applySchema(
  api: MetaApi,
  desired: readonly TableSpec[],
  options: { dryRun?: boolean } = {},
): Promise<ApplySummary> {
  const existing = await api.listTables()
  const plan = planSchema(existing, desired)
  const tableIds: TableIds = new Map(existing.map((table) => [table.name, table.id]))

  if (options.dryRun === true) {
    // Still checked, so a dry run catches a bad `linkTo` rather than reporting a
    // plan that cannot be applied. Tables pass one would create count as resolved.
    for (const table of plan.createTables) tableIds.set(table.name, `(pending) ${table.name}`)
    checkLinkTargets(plan, tableIds)
    return { plan, createdTables: [], createdFields: 0, widenedFields: 0 }
  }

  const createdTables = await createMissingTables(api, plan, tableIds)
  checkLinkTargets(plan, tableIds)
  const createdFields = await addMissingFields(api, plan, tableIds)
  const widenedFields = await widenChoiceFields(api, plan, tableIds)

  return { plan, createdTables, createdFields, widenedFields }
}
