'use server'

// The import wizard's Server Actions. BUILD_SPEC 5.0e.
//
// Four, and the split between them is the "preview before commit" rule made structural:
// `previewImportAction` and `listSessionboardEventsAction` write NOTHING, and
// `startImportAction` is the first call in the whole flow that can create a record. An
// organizer who never presses `Import` leaves this event exactly as they found it.
//
// EVERY ONE AUTHORIZES FOR ITSELF, with `requireImportAdmin`, before it reads anything. A
// layout is not a security boundary: an action is reachable by POST without the wizard ever
// rendering, and capability comes from `EventMemberships` on every call rather than from a
// role baked into the session cookie (BUILD_SPEC section 4). The preview is guarded too,
// because it reads a third party's event and this event's mappings.
//
// THE SESSIONBOARD TOKEN TRAVELS AND IS NEVER STORED. It arrives in the body of these
// calls, lives in the closure `run-wiring.ts` builds, and is gone when the request ends.
// There is deliberately no credential column on `ImportRuns`, which has a consequence this
// file has to carry rather than discover: the cron sweep holds no token, so it reports
// `no-client` and leaves a Sessionboard run `running` with a lapsed lease. This wizard is
// therefore the only thing that can finish one, which is why `advanceImportAction` exists
// and why the client keeps calling it until the run ends.
//
// Failures come back as VALUES rather than thrown. A thrown AppError crossing the action
// boundary reaches the browser as a redacted digest, and "Sessionize has no endpoint by
// that id" is something an organizer can act on once they are told it.

import { requireImportAdmin, requireImportAdminForRun } from '@/features/imports/authorize'
import { previewImport } from '@/features/imports/preview'
import { type ImportRunReport, runImport } from '@/features/imports/run'
import { importPreviewDeps, importRunDeps } from '@/features/imports/run-wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createImportRun } from '@/services/airtable/mutations-imports'
import {
  createSessionboardClient,
  SESSIONBOARD_REGIONS,
  type SessionboardRegion,
} from '@/services/imports/sessionboard'
import {
  EMPTY_IMPORT_MAPPING,
  IMPORT_SOURCES,
  type ImportMapping,
  type ImportPreview,
  type ImportSource,
} from '@/types/imports'

/** What every action here needs to know before it does anything. */
type ImportRequest = {
  eventId: string
  source: ImportSource
  /** The far side's identity. Never a credential: `sourceRef` is a readable column. */
  sourceRef: string
  /** Sessionize's confirmed category choices. Empty for the two typed sources. */
  mapping?: ImportMapping
  /** Sessionboard only, and only for the length of this request. */
  sessionboardToken?: string
}

/**
 * The source arrives from a route segment, so it is checked rather than cast.
 *
 * `ImportSource` is a closed union in the type system only; what reaches an action is a
 * string somebody could have typed. An unchecked one would be written into the run row's
 * `source` column and then fall through `fetchSource`'s final branch to the Accelevents
 * reader, which is an import of the wrong event rather than an error.
 */
function assertSource(source: string): asserts source is ImportSource {
  if (!(IMPORT_SOURCES as readonly string[]).includes(source)) {
    throw new TypeError(`unknown import source: ${source}`)
  }
}

function assertRegion(region: string): asserts region is SessionboardRegion {
  if (!(SESSIONBOARD_REGIONS as readonly string[]).includes(region)) {
    throw new TypeError(`unknown Sessionboard region: ${region}`)
  }
}

/**
 * The dry run: fetch the far side, map it, count it. Writes nothing.
 *
 * Safe to call as often as a step is re-entered, because it is exactly the reads the real
 * run starts with and it consults `IntegrationMappings` only to split creates from updates.
 * The Sessionize flow calls it twice on purpose, once to learn what categories exist and
 * again with the organizer's confirmed mapping, and the second call is what makes the
 * counts on the preview describe the import that is about to happen.
 *
 * ONE EVENT ID AND NO RUN ID, which is why `requireImportAdmin` is the whole guard here.
 * The only bodo data this reads is `loadRemoteIndex(input.eventId)`, the same event the
 * capability was just checked against, so there is no second id for a caller to point
 * somewhere else. Everything else comes off the far side through credentials the caller
 * supplied themselves, and a preview writes nothing either way.
 */
export async function previewImportAction(
  input: ImportRequest,
): Promise<ActionResult<{ preview: ImportPreview }>> {
  try {
    assertSource(input.source)
    await requireImportAdmin(input.eventId)
    const preview = await previewImport(
      {
        eventId: input.eventId,
        source: input.source,
        sourceRef: input.sourceRef,
        mapping: input.mapping ?? EMPTY_IMPORT_MAPPING,
      },
      importPreviewDeps({ sessionboardToken: input.sessionboardToken }),
    )
    return actionOk({ preview })
  } catch (error) {
    return actionFailure(error)
  }
}

export type SessionboardEventOption = { id: string; name: string }

/**
 * The events this token can see, for the Sessionboard credentials step.
 *
 * A picker rather than a free-text id, because their event id is an integer with no
 * checksum: a typo resolves to a real event belonging to the same organization, and the
 * import would then bring in somebody else's conference with no error anywhere. The list is
 * fetched with the token the organizer just pasted and is not stored either.
 */
export async function listSessionboardEventsAction(input: {
  eventId: string
  region: string
  token: string
}): Promise<ActionResult<{ events: readonly SessionboardEventOption[] }>> {
  try {
    assertRegion(input.region)
    await requireImportAdmin(input.eventId)
    const client = createSessionboardClient({ region: input.region, token: input.token })
    const events = (await client.listEvents()).map((event) => ({
      id: event.id,
      // Their `name` is nullable. The id is shown rather than "Untitled" so the row stays
      // identifiable against the far side's own UI.
      name: event.name ?? `Event ${event.id}`,
    }))
    return actionOk({ events })
  } catch (error) {
    return actionFailure(error)
  }
}

export type ImportStartResult = { runId: string; report: ImportRunReport }

/**
 * Press `Import`: create the run row, then immediately advance it one phase.
 *
 * The row is created BEFORE any work starts and never after it, because the row IS the
 * resume point: a run whose row appeared once the writing was underway would have no record
 * of the phases before it, and a Worker CPU limit hit in between would leave records in the
 * base with nothing pointing at them.
 *
 * The first phase runs in THIS call rather than in a second round trip, and that closes a
 * real race rather than saving a hop. The imports cron sweep runs every two minutes and
 * picks up `queued` rows; if it reached this row first it would claim
 * `import:<runId>` through the ClaimGuard Durable Object for the lease window, and for a
 * Sessionboard run it would then fail with `no-client` and hold the lease while the
 * organizer's own wizard, the only caller that has the token, was told `contended`.
 * Claiming in the same request that created the row leaves nothing for the sweep to take.
 *
 * `requireImportAdmin` is enough here and `requireImportAdminForRun` is not needed, because
 * the run id is not the caller's: it was created in this call, from the event id the
 * capability was just checked against, so the event `runImport` reads off the row is the
 * authorized one by construction. Every later call carries a run id the caller sends back,
 * which is why `advanceImportAction` cannot use the same argument.
 */
export async function startImportAction(
  input: ImportRequest,
): Promise<ActionResult<ImportStartResult>> {
  try {
    assertSource(input.source)
    await requireImportAdmin(input.eventId)

    const runId = await createImportRun(
      {
        eventId: input.eventId,
        source: input.source,
        sourceRef: input.sourceRef,
        mapping: input.mapping ?? EMPTY_IMPORT_MAPPING,
      },
      'action',
    )

    const report = await runImport(runId, importRunDeps(input))
    return actionOk({ runId, report })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Carry a run forward by one phase, in the request that holds the credential.
 *
 * One phase per call, which is `maxPhases: 1` in `importRunDeps` and is the same budget the
 * cron route takes: a phase is the largest unit that reliably fits under a Worker's CPU
 * limit, and the wizard gets a progress bar out of the boundary rather than a spinner.
 *
 * Idempotent in the way that matters. Two calls that overlap do not both import: the second
 * loses `claimOnce` and comes back `contended`, and a call arriving after the run finished
 * comes back `terminal`. Nothing here re-reads the row to decide that, because the engine
 * already does and a second opinion would be the one that is stale.
 *
 * AUTHORIZED AGAINST THE RUN'S EVENT, NOT THE CALLER'S CLAIM. This takes two ids and they
 * are not tied together by anything the type system can see: `runImport` reads the event
 * off the run row and writes that event, so checking capability against `input.eventId`
 * would let an admin of one event drive an import that writes another. See
 * `requireImportAdminForRun`.
 */
export async function advanceImportAction(input: {
  eventId: string
  runId: string
  sessionboardToken?: string
}): Promise<ActionResult<{ report: ImportRunReport }>> {
  try {
    await requireImportAdminForRun(input.runId, input.eventId)
    const report = await runImport(input.runId, importRunDeps(input))
    return actionOk({ report })
  } catch (error) {
    return actionFailure(error)
  }
}
