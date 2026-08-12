// Live reads for ImportRuns, plus the remote-to-local index the import runs against.
//
// The split this file is built on is reads-portal.ts's, and it is worth restating because
// ImportRuns has more uncached reads than cached ones: a read that a PAGE renders declares
// its tags and its window, and a read that a JOB decides from declares neither. An import
// is a job with a resume point, so nearly everything here is the second kind. A cached
// answer to "what has this run already done" is not a slightly stale screen, it is a
// resumed run redoing a finished phase or skipping an unfinished one.
//
// The same "filter in code, not in a formula" rule from reads.ts applies, and for the
// usual reason: `event` is a LINK, and a formula sees a linked record as its primary
// field's text rather than as a record id (formula.ts).
//
// The joins and the ordering are exported as pure functions so they are unit tested
// directly; everything that talks to the network is a thin wrapper around one of them.

import type { IntegrationMapping } from '@/services/accelevents/sync-types'
import { getClient } from '@/services/airtable/client'
import { mapMapping } from '@/services/airtable/mapping-accelevents'
import { mapImportRun } from '@/services/airtable/mapping-imports'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { TABLES } from '@/services/airtable/tables'
import { eventIntegrationsTag } from '@/services/airtable/tags'
import type { ImportRun, ImportSource } from '@/types/imports'

/**
 * Newest first, where "newest" is `finishedAt`, else `startedAt`, else nothing at all.
 *
 * A run with neither is one that has never been claimed, and it sorts FIRST rather than
 * last: the only rows without a `startedAt` are queued ones, so they are by definition
 * the most recent thing that has happened to this provider, and they are the row the
 * organizer is actually waiting on.
 *
 * That is also why the ordering is done here instead of as a `sort` on the request.
 * Airtable orders a blank dateTime as the smallest value, so asking it for
 * `startedAt desc` buries every queued run at the bottom of the history, which is exactly
 * backwards. Sorting six or seven rows in code costs nothing.
 */
export function runsNewestFirst(runs: readonly ImportRun[]): readonly ImportRun[] {
  const at = (run: ImportRun): string | undefined => run.finishedAt ?? run.startedAt
  return [...runs].sort((left, right) => {
    const leftAt = at(left)
    const rightAt = at(right)
    // "No timestamp" is handled before the comparison rather than by substituting `''`,
    // because an empty string is SMALLER than every ISO instant and a descending sort
    // would then put the queued run last, which is the exact ordering this function
    // exists to avoid. Ties keep their input order (`Array.prototype.sort` is stable).
    if (leftAt === undefined) return rightAt === undefined ? 0 : -1
    if (rightAt === undefined) return 1
    return rightAt.localeCompare(leftAt)
  })
}

/**
 * One provider's run history for one event: what the registry row expands into.
 *
 * The one cached read in this file. `eventIntegrationsTag` covers `IntegrationMappings`,
 * `SyncLog` and this table together, because the Integrations page reads all three and
 * every control on it writes to more than one (tags.ts says why that is one tag rather
 * than three).
 *
 * The window matters less than the tag: every write in mutations-imports.ts expires this,
 * so `REVALIDATE.edited` is only what covers a row an organizer edited in Airtable
 * directly.
 */
export async function listImportRuns(eventId: string): Promise<readonly ImportRun[]> {
  return runsNewestFirst(
    await listByEvent(TABLES.importRuns, eventId, mapImportRun, {
      cache: { tags: [eventIntegrationsTag(eventId)], revalidate: REVALIDATE.edited },
    }),
  )
}

/**
 * One run by record id. UNCACHED, and this is the read the whole resume design rests on.
 *
 * The run engine reads this to decide what to do next: which phase to work on, what the
 * counts are so far, whether somebody else is holding it. A cached answer here does not
 * show a stale screen, it makes a resumed run act on the state the row had a minute ago,
 * which is either redoing a phase that has already finished or skipping one that has not.
 * It passes no `ReadCache`, so `cacheInit` sends an explicit `no-store` rather than
 * leaving it to a default (read-cache.ts). Asserted in tests/airtable-imports.test.ts.
 */
export async function getImportRun(runId: string): Promise<ImportRun> {
  return mapImportRun(await getClient().getRecord(TABLES.importRuns, runId))
}

/**
 * The holder recorded on one run right now, or undefined when it carries none.
 *
 * Uncached, and for the same reason `outboxLeaseHolder` is rather than as a preference:
 * the run engine reads this to decide whether its own write is still the freshest one, so
 * a cached answer would fence against a holder the row has since handed on, which is
 * exactly the mistake the read exists to catch.
 *
 * And the warning that belongs on every mention of these columns: what comes back is a
 * RECORD of what `claimOnce()` decided, not the grant itself. Airtable has no
 * compare-and-swap, so two callers can both write `leaseHolder` and both believe they
 * won. Comparing it is a check on whether this worker is still the one that was granted
 * the lease, never a way to acquire it.
 */
export async function importRunLeaseHolder(runId: string): Promise<string | undefined> {
  return mapImportRun(await getClient().getRecord(TABLES.importRuns, runId)).leaseHolder
}

/**
 * Runs a sweep should pick up: queued, or claimed by somebody who has stopped.
 *
 * `running` is included and the lapsed lease is the only thing holding it back, which is
 * `dueOutboxRows`' rule and is even more load-bearing here. A phase-at-a-time run is
 * SUPPOSED to be interrupted: the Worker CPU limit ends a phase, the isolate goes away,
 * and the row sits at `running` until somebody resumes it. Excluding the status outright
 * would strand every long import at whatever phase it reached, with no error and nothing
 * to retry. A `running` row whose lease is still in the future stays out, which is the
 * mid-flight protection that actually matters.
 *
 * An absent `leaseExpiresAt` on a `running` row counts as lapsed. The claim writes both
 * columns in one request, so that combination should not occur, and treating it as
 * resumable rather than held is the direction that cannot leave an import half-done.
 *
 * `failed` stays OUT, and that is the one place this parts company with the outbox. The
 * outbox retries a failure because `attempts` and a cap decide when to stop; ImportRuns
 * has no attempts column, so an automatic retry would have nothing to terminate it and a
 * permanently failing source would be re-imported forever. A failed run is re-run by the
 * organizer pressing `Import`, which creates a fresh history row. `done` stays out for
 * the reason it exists.
 *
 * The lease comparison is a string comparison, which is correct only because every
 * instant this DAL writes is an ISO-8601 UTC string of the same shape, so lexical order
 * is chronological order. Oldest first, so a backlog is worked in the order it was
 * queued.
 */
export function dueImportRuns(runs: readonly ImportRun[], nowIso: string): readonly ImportRun[] {
  return runs
    .filter(
      (run) =>
        run.status === 'queued' ||
        (run.status === 'running' &&
          (run.leaseExpiresAt === undefined || run.leaseExpiresAt <= nowIso)),
    )
    .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
}

/**
 * Every run waiting to be worked on, across every event.
 *
 * Never cached, for `listDueOutbox`'s reason: this is what a cron sweep reads to decide
 * what to claim, and a cached queue hands a second invocation runs the first has already
 * picked up. Not event-scoped, because the sweep does not know which events have work.
 *
 * `nowIso` is a parameter rather than read from the clock here, so one sweep evaluates
 * every row against a single instant. A clock read per row makes the lapsed-lease
 * boundary move underneath the filter.
 */
export async function listQueuedImportRuns(nowIso: string): Promise<readonly ImportRun[]> {
  const records = await getClient().listAll(TABLES.importRuns)
  return dueImportRuns(records.map(mapImportRun), nowIso)
}

// ── The reverse-direction lookup ──────────────────────────────────────────────
//
// `IntegrationMappings` uniqueness is (event, entityType, localId), and every lookup an
// import makes goes the OTHER way: it holds a remote id and needs the local record, if
// any, that it already stands for. BUILD_SPEC 5.0e names this as a thing to handle
// rather than discover, because the naive shape is a lookup per imported row, and a
// per-row fan-out against a base under a ~5 req/s cap is the exact failure §3.1 exists to
// prevent. So the event's rows are read once and indexed in one pass.

/** The event's mappings, addressed the way an import needs them. */
export type RemoteIndex = ReadonlyMap<string, IntegrationMapping>

/**
 * The stored key for one remote record.
 *
 * **The prefix is the namespace.** Remote ids are namespaced by source
 * (`sessionize:14022`, `sessionboard:<uuid>`) precisely so two providers cannot collide
 * on the same integer, and Accelevents' rows are being prefixed in the same change that
 * adds this. So the index reads TOLERANTLY: it keys on whatever the column holds, and
 * `findRemoteMapping` falls back to the bare id, which is what an Accelevents row written
 * before that change carries. Neither side validates the prefix, because a row that has
 * not been migrated yet is a row to look up, not a row to reject.
 */
export function remoteKey(source: ImportSource, remoteId: string): string {
  return `${source}:${remoteId}`
}

/**
 * One event's mappings, keyed by remote id, in a single pass.
 *
 * Filtering by event happens in the same pass rather than in a formula, because `event`
 * is a link (see the header). Two rows CAN claim the same remote id, since uniqueness is
 * on the other three columns, and it means two local records were mapped to one remote
 * thing. The newest `syncedAt` wins: the older row is a mapping some superseded local
 * record left behind, and resolving to it would have the import update a record the
 * organizer has already replaced. First-wins would make the answer depend on Airtable's
 * page order, which is not an answer at all.
 */
export function indexByRemoteId(
  mappings: readonly IntegrationMapping[],
  eventId: string,
): RemoteIndex {
  const index = new Map<string, IntegrationMapping>()
  for (const mapping of mappings) {
    if (mapping.eventId !== eventId) continue
    const held = index.get(mapping.remoteId)
    if (held !== undefined && held.syncedAt >= mapping.syncedAt) continue
    index.set(mapping.remoteId, mapping)
  }
  return index
}

/**
 * Build the index for one event.
 *
 * Uncached, and it is the same guarantee the other job reads here make rather than a
 * preference: the run WRITES mappings as it creates records, so a cached index would
 * answer a later phase with the state before the earlier one, and every record the run
 * already created would look new and be created again. One list read, paginated to
 * completion by the client, in place of a lookup per imported row.
 *
 * This is also what the Accelevents round-trip guard consumes. Accelevents is the one
 * source bodo also pushes TO, so importing from a remote event bodo has been pushing into
 * would re-import bodo's own writes and duplicate every session; the mappings record every
 * remote id bodo authored, and a hit here is what makes the run skip the row and count it
 * as `skipped` rather than silently subtract it.
 *
 * Rows are read through `mapMapping`, which keeps `remoteId` exactly as stored, and NOT
 * through the sweep's `listIntegrationMappings`: that one drops every row belonging to
 * another provider, which is right for a push that must never PUT a Sessionize id at
 * Accelevents and wrong here, where a Sessionize import has to find the Sessionize rows.
 * The whole event's mappings are what an import needs, whoever wrote them.
 */
export async function loadRemoteIndex(eventId: string): Promise<RemoteIndex> {
  // Whole table, filtered by event in the indexing pass. `event` is a link, and a
  // formula sees a linked record as its primary field's text rather than as a record
  // id, so there is no correct `filterByFormula` for it (formula.ts).
  const records = await getClient().listAll(TABLES.integrationMappings)
  return indexByRemoteId(records.map(mapMapping), eventId)
}

/**
 * The local record one remote id already stands for, or undefined.
 *
 * Two keys are tried, namespaced first: an unprefixed hit is a pre-migration Accelevents
 * row (see `remoteKey`), and refusing it would make the round-trip guard miss exactly the
 * rows it exists to catch.
 *
 * `entityType` is checked when the caller names one, and callers should. The namespace is
 * the SOURCE, not the entity, so within one source a room and a category item can carry
 * the same integer; without the check, a session would resolve to a room's mapping and the
 * import would update the wrong record.
 */
export function findRemoteMapping(
  index: RemoteIndex,
  source: ImportSource,
  remoteId: string,
  entityType?: IntegrationMapping['entityType'],
): IntegrationMapping | undefined {
  const found = index.get(remoteKey(source, remoteId)) ?? index.get(remoteId)
  if (found === undefined) return undefined
  return entityType === undefined || found.entityType === entityType ? found : undefined
}
