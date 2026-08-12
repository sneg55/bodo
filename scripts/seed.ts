// Seed the base with the BUILD_SPEC section 9 demo scenario.
//
//   node --env-file-if-exists=.env --import tsx scripts/seed.ts
//
// Needs AIRTABLE_TOKEN (data.records:read and data.records:write on this base) and
// AIRTABLE_BASE_ID, and needs scripts/airtable-schema.ts to have run first: this only
// writes rows, it creates no columns.
//
// Idempotent. Every step looks its rows up by a natural key before writing (the event
// slug, the form's publicId, a submission title, the unique tuples from section 3), so
// running it twice adds nothing. Nothing here updates or deletes a row an organizer has
// touched either, with one exception that says so at its call site: the two placed
// sessions are re-placed on their declared slot, which is where they already are.
//
// What a judge should be able to do afterwards, per section 9: submit through the
// public form, log into the portal, review, accept, schedule, WATCH THE CONFLICT FLAG,
// complete a task, see the dashboard move. The conflict is seeded deliberately, and
// steps-content.ts and scenario.ts both say so, because a demo of conflict detection
// with nothing to detect demonstrates nothing.
//
// Runs under Node, not Workers. Nothing in src/app or src/features may import it.

import { createClient } from '@/services/airtable/client'
import { getScheduler } from '@/services/airtable/scheduler'
import { credentials, run, say } from './lib/output'
import { makeContext } from './seed/ensure'
import { CONFLICT, EVENT, FORM } from './seed/scenario'
import { seedContent } from './seed/steps-content'
import { seedForm } from './seed/steps-form'
import { seedFoundation } from './seed/steps-foundation'
import { seedPortal } from './seed/steps-portal'
import { seedReview } from './seed/steps-review'
import { SUBMISSIONS } from './seed/submissions-data'

/**
 * What to look at, once it has run.
 *
 * Printed rather than left implicit because the two deliberate landmines are the whole
 * point of the seed and neither is obvious from a row count: a base that came out
 * without the double-booking looks exactly like one that came out with it.
 */
function reportScenario(): void {
  say('')
  say(`seeded ${EVENT.name} (slug ${EVENT.slug}) with ${SUBMISSIONS.length} submissions.`)
  say(`  public CFP form: /submit/${EVENT.slug}/${FORM.publicId}`)
  say(`  deliberate room conflict in ${CONFLICT.room}:`)
  say(`    ${CONFLICT.a.title}`)
  say(`    ${CONFLICT.b.title}`)
  say(`  and the same co-speaker on both, so the participant rule fires on that pair too.`)
  say('  the agenda Conflicts tab should show them on a fresh run.')
}

run(async () => {
  const { baseId, token } = credentials()

  // The DAL's own client: it chunks writes at Airtable's 10-record ceiling and routes
  // every request through the per-base scheduler, so this script inherits the rate cap
  // and the backoff rather than reimplementing them (BUILD_SPEC 3.1).
  const client = createClient({ baseId, token, scheduler: getScheduler(baseId) })
  const ctx = makeContext({ client, report: say })

  say('seeding. one line per table, created then already present:')
  const foundation = await seedFoundation(ctx)
  const formId = await seedForm(ctx, foundation)
  const content = await seedContent(ctx, foundation, formId)
  await seedReview(ctx, foundation, content)
  await seedPortal(ctx, foundation, content)

  reportScenario()
})
