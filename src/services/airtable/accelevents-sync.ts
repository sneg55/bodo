// Durable Accelevents retry state.
//
// The mock records calls only inside one isolate. SyncLog and
// IntegrationMappings are the durable contract for both mock and live clients, so
// the cron path reads and writes the same Airtable rows either way.
//
// There are two scopes here and they are not interchangeable. The unscoped reads
// (`listFailedSyncLogs`, `listIntegrationMappings`) are the CRON sweep's: it is
// cross-event on purpose, since one schedule drains the backlog of every event, and
// they are uncached because a job that reads its worklist from a cache can be handed
// the same rows twice. The `listEvent*` reads below are the Integrations PAGE's: one
// event, cached under `eventIntegrationsTag`, and expired by every control on it.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { toNamespacedRemoteId } from '@/services/accelevents/remote-id'
import { hashAcceleventsPayload } from '@/services/accelevents/request-hash'
import type {
  FailedSyncRow,
  IntegrationMapping,
  MappingWrite,
  SyncLogRow,
  SyncLogWrite,
} from '@/services/accelevents/sync-types'
import { getClient } from '@/services/airtable/client'
import { mapEvent } from '@/services/airtable/mapping'
import {
  mapMapping,
  mapSyncLog,
  mapSyncLogEntry,
  type SyncLogEntry,
  toAccelMapping,
} from '@/services/airtable/mapping-accelevents'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { listByEvent } from '@/services/airtable/reads'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventIntegrationsTag } from '@/services/airtable/tags'

function identityKey(row: Pick<SyncLogRow, 'eventId' | 'entityType' | 'localId'>): string {
  return JSON.stringify([row.eventId, row.entityType, row.localId])
}

export async function listFailedSyncLogs(): Promise<readonly FailedSyncRow[]> {
  const records = await getClient().listAll(TABLES.syncLog, {
    sort: [{ field: COL.at, direction: 'asc' }],
  })
  const rows = await Promise.all(
    records.map(async (record) => {
      const row = mapSyncLog(record)
      return { ...row, requestHash: await hashAcceleventsPayload(row.payload) }
    }),
  )

  // Only the newest attempt for an entity can be actionable. Replaying an older
  // failed payload after a newer payload succeeded would overwrite fresh data.
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) latest.set(identityKey(row), row)

  const failed: FailedSyncRow[] = []
  for (const row of latest.values()) {
    if (row.status === 'failed') failed.push({ ...row, status: 'failed' })
  }
  return failed
}

/**
 * Every mapping row in the base, ids as stored.
 *
 * Cross-provider and cross-event on purpose. The importers' reverse lookup
 * (`loadRemoteIndex` in reads-imports.ts) keys on the namespaced id, so this one must
 * NOT strip or filter: dropping the rows of the two pull providers would make an import
 * re-create every record it had already created.
 */
export async function listIntegrationMappings(): Promise<readonly IntegrationMapping[]> {
  return (await getClient().listAll(TABLES.integrationMappings)).map(mapMapping)
}

/**
 * The same rows, narrowed to what the PUSH may act on: Accelevents only, ids bare.
 *
 * A separate read rather than a flag on the one above, because the two callers want
 * opposite things and a boolean parameter is how the wrong one gets passed. The push
 * matches a mapping on (event, entityType, localId) alone, so an importer's row reaching
 * it would read as "this entity already exists remotely" and send a PUT carrying a
 * Sessionize id to Accelevents.
 */
export async function listAcceleventsMappings(): Promise<readonly IntegrationMapping[]> {
  const records = await getClient().listAll(TABLES.integrationMappings)
  const mappings: IntegrationMapping[] = []
  for (const record of records) {
    const mapping = toAccelMapping(record)
    if (mapping !== undefined) mappings.push(mapping)
  }
  return mappings
}

/** The push's mappings for ONE event: what the forward walk indexes before it starts. */
export async function listEventAcceleventsMappings(
  eventId: string,
): Promise<readonly IntegrationMapping[]> {
  return (await listAcceleventsMappings()).filter((mapping) => mapping.eventId === eventId)
}

/**
 * The page's Mappings table: one event, every provider, ids as stored.
 *
 * Filtered in code rather than by formula, for the reason reads.ts gives at length: an
 * Airtable formula sees a linked record as its primary field's TEXT, so `{event} =
 * 'recABC'` matches nothing and the name-based version breaks the day the event is
 * renamed.
 */
export async function listEventIntegrationMappings(
  eventId: string,
): Promise<readonly IntegrationMapping[]> {
  return await listByEvent(TABLES.integrationMappings, eventId, mapMapping, {
    cache: { tags: [eventIntegrationsTag(eventId)], revalidate: REVALIDATE.edited },
  })
}

/**
 * The page's Sync log: one event, newest first.
 *
 * Newest first because this is the table an organizer opens after pressing Sync now, and
 * the row they need is the one that was just written. The sweep's read sorts the other
 * way for its own reason (it keeps the LAST attempt per entity by overwriting as it
 * scans), which is why these are two reads rather than one with an argument.
 */
export async function listEventSyncLogs(eventId: string): Promise<readonly SyncLogEntry[]> {
  return await listByEvent(TABLES.syncLog, eventId, mapSyncLogEntry, {
    sort: [{ field: COL.at, direction: 'desc' }],
    cache: { tags: [eventIntegrationsTag(eventId)], revalidate: REVALIDATE.edited },
  })
}

/**
 * Which remote event this one pushes to.
 *
 * Both fields per §5.7, but only the URL is enforced, and the asymmetry is deliberate:
 * every path in `client.ts` is built from the slug, so a missing slug means no call can
 * be made at all, while `accelEventId` is carried and not yet dereferenced by any call
 * in the contract. Refusing a sync over a field nothing reads would block a push that
 * would have worked. The pull side in §5.0e scopes its list endpoints by id, and that is
 * the read that gets to require it.
 */
export type AcceleventsIdentity = { eventUrl: string; accelEventId?: string }

export async function getAcceleventsIdentity(eventId: string): Promise<AcceleventsIdentity> {
  const event = mapEvent(await getClient().getRecord(TABLES.events, eventId))
  if (event.accelEventUrl === undefined) {
    throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'event has no Accelevents event URL', {
      eventId,
    })
  }
  return { eventUrl: event.accelEventUrl, accelEventId: event.accelEventId }
}

export async function getAcceleventsEventUrl(eventId: string): Promise<string> {
  return (await getAcceleventsIdentity(eventId)).eventUrl
}

/**
 * The only writer of an Accelevents mapping row, and therefore the only place the
 * `accelevents:` namespace has to be applied. Callers hand over the bare remote id the
 * API returned; what lands in the column is prefixed. See remote-id.ts.
 */
export async function saveIntegrationMapping(write: MappingWrite): Promise<void> {
  const fields = {
    [COL.event]: [write.eventId],
    [COL.entityType]: write.entityType,
    [COL.localId]: write.localId,
    [COL.remoteId]: toNamespacedRemoteId(write.remoteId),
    [COL.requestHash]: write.requestHash,
    [COL.syncedAt]: write.syncedAt,
  }
  if (write.mappingId === undefined) {
    await getClient().createRecords(TABLES.integrationMappings, [fields])
    return
  }
  await getClient().updateRecords(TABLES.integrationMappings, [{ id: write.mappingId, fields }])
}

export async function writeSyncLog(write: SyncLogWrite): Promise<void> {
  await getClient().createRecords(TABLES.syncLog, [
    {
      [COL.event]: [write.eventId],
      [COL.entityType]: write.entityType,
      [COL.localId]: write.localId,
      [COL.remoteId]: write.remoteId,
      [COL.action]: write.action,
      [COL.status]: write.status,
      [COL.payloadJson]: JSON.stringify(write.payload),
      [COL.error]: write.error,
      [COL.at]: write.at,
    },
  ])
}
