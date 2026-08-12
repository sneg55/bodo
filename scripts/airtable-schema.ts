// Create or verify every table and field in BUILD_SPEC section 3.
//
//   node --env-file-if-exists=.env --import tsx scripts/airtable-schema.ts
//   ... --dry-run     read and diff, write nothing
//
// Needs AIRTABLE_TOKEN (scoped schema.bases:read and schema.bases:write, granted on
// the one base) and AIRTABLE_BASE_ID. Create the base itself in the Airtable UI
// first: the Metadata API can add tables to a base, not create one.
//
// Safe to run against a base that already has data. It only ever CREATES: a table
// or a field that already exists is left exactly as it is, and a field whose type
// disagrees with the declaration is reported for a human to settle rather than
// converted, because a converted column is not recoverable and the organizer whose
// column it is did not ask for it.
//
// This runs under Node, not Workers, so process and the real clock are fine here.
// Nothing in src/app or src/features may import it.

import { planIsEmpty, type SchemaPlan } from '@/migrations/diff'
import { SCHEMA } from '@/migrations/schema'
import { getScheduler } from '@/services/airtable/scheduler'
import { type ApplySummary, applySchema } from './lib/apply-schema'
import { createMetaApi } from './lib/meta-api'
import { count, credentials, run, say } from './lib/output'

/** Field additions grouped for reading, since 30 lines of one field each is noise. */
function fieldSummary(plan: SchemaPlan): readonly string[] {
  const byTable = new Map<string, number>()
  for (const add of plan.addFields) {
    byTable.set(add.tableName, (byTable.get(add.tableName) ?? 0) + 1)
  }
  return [...byTable].map(([table, n]) => `  ${table}: ${count(n, 'field')}`)
}

function reportPlan(plan: SchemaPlan, verb: string): void {
  say(`${verb} ${count(plan.createTables.length, 'table')}:`)
  for (const table of plan.createTables) say(`  ${table.name}`)
  say(`${verb} ${count(plan.addFields.length, 'field')}:`)
  for (const line of fieldSummary(plan)) say(line)
  // A dry run has to show this too. Reporting it only on the applying path is how the
  // gap it was written for stayed invisible: `--dry-run` is what anybody checks before
  // touching a base somebody else is using, and it said "0 fields" while the base could
  // not store a value the app would send.
  // Its own verb, not the caller's: widening is not creating, and "would create widen"
  // is what gluing them together produces.
  reportChoicePlan(plan, verb.startsWith('would') ? 'would widen' : 'widened')
}

/**
 * Selects that need choices, named one by one rather than counted.
 *
 * "widened 1 field" says nothing about which vocabulary changed under a base somebody
 * else is using, and this is the only thing the script does to a column that already
 * exists.
 */
function reportChoicePlan(plan: SchemaPlan, verb: string): void {
  if (plan.choiceAdds.length === 0) return
  say('')
  say(`${verb} ${count(plan.choiceAdds.length, 'select')}:`)
  for (const add of plan.choiceAdds) {
    say(`  ${add.tableName}.${add.fieldName}: + ${add.add.join(', ')}`)
  }
  say('Existing choices are kept, ids intact. Nothing is renamed or removed.')
}

/**
 * A type disagreement is the one outcome that exits non-zero on an otherwise
 * successful run. It is not a failure of this script, it is a base and a declaration
 * that have drifted, and it stays quiet in a log if nobody is told loudly.
 */
function reportMismatches(plan: SchemaPlan): void {
  if (plan.mismatches.length === 0) return
  say('')
  say(`${count(plan.mismatches.length, 'field')} exist with a different type, left untouched:`)
  for (const mismatch of plan.mismatches) {
    say(
      `  ${mismatch.tableName}.${mismatch.fieldName}: declared ${mismatch.declared}, base has ${mismatch.actual}`,
    )
  }
  say('Change the declaration in src/migrations, or the column in Airtable. Nothing was altered.')
  process.exitCode = 1
}

/**
 * Fields the Meta API will not create. Reported every run, including the run that
 * otherwise reports the base as matching, because the base does NOT match until a human
 * has added these and the DAL reads them.
 *
 * Not an error exit: the migration did everything it can do, and failing would make a
 * correct run indistinguishable from a broken one. Verified the hard way, by the API
 * rejecting an autoNumber inside the Submissions create with 422.
 */
function reportManual(plan: SchemaPlan): void {
  if (plan.manual.length === 0) return
  say('')
  say(`${count(plan.manual.length, 'field')} must be added by hand, Airtable cannot create them:`)
  for (const field of plan.manual) {
    say(`  ${field.tableName}.${field.fieldName} (${field.type})`)
  }
  say('Add each in the Airtable UI with exactly that name and type. The API refuses to')
  say('accept a definition for a value Airtable computes itself, so this is once per base.')
}

function reportApplied(summary: ApplySummary): void {
  const { plan } = summary
  say(
    `matched ${count(plan.matchedTables.length, 'table')} and ${count(plan.matchedFields, 'field')} already in place.`,
  )
  if (planIsEmpty(plan)) {
    say('the base already matches the declaration. Nothing to create.')
    return
  }
  say(`created ${count(summary.createdTables.length, 'table')}:`)
  for (const table of summary.createdTables) say(`  ${table}`)
  say(`created ${count(summary.createdFields, 'field')}.`)
  reportChoicePlan(summary.plan, 'widened')
}

run(async () => {
  const { baseId, token } = credentials()
  const dryRun = process.argv.includes('--dry-run')

  // The DAL's scheduler, not a second one: metadata calls draw on the same 5
  // requests per second per base as record calls do (BUILD_SPEC 3.1).
  const api = createMetaApi({ baseId, token, scheduler: getScheduler(baseId) })

  say(`${dryRun ? 'planning' : 'applying'} every migration against the configured base.`)
  const summary = await applySchema(api, SCHEMA, { dryRun })

  if (dryRun) {
    reportPlan(summary.plan, 'would create')
  } else {
    reportApplied(summary)
  }
  reportMismatches(summary.plan)
  reportManual(summary.plan)
})
