// Airtable rows to app records for `SyncLog` and `IntegrationMappings`.
//
// Split out of accelevents-sync.ts, which owns the reads and writes. The mappers moved
// because there are now two callers with opposite needs and the difference is entirely
// in the MAPPING, not in the query: the push side wants Accelevents rows with a bare
// remote id, the Integrations page and the importers want every provider's rows exactly
// as stored. Keeping both shapes next to each other is the only way that pair stays
// legible, and it took the read file over the size limit.
//
// Two mappers per table for the same reason, and neither is a convenience wrapper:
// `mapSyncLog` validates the payload because the sweep REPLAYS it, `mapSyncLogEntry`
// refuses to because the page only lists it.

import type { ZodType } from 'zod'

import { fromNamespacedRemoteId } from '@/services/accelevents/remote-id'
import {
  INTEGRATION_ENTITY_TYPES,
  type IntegrationMapping,
  SYNC_ACTIONS,
  SYNC_ENTITY_TYPES,
  SYNC_STATUSES,
  type SyncAction,
  type SyncEntityType,
  type SyncLogRow,
  type SyncStatus,
  sessionPayloadSchema,
  speakerPayloadSchema,
  tagPayloadSchema,
  trackPayloadSchema,
} from '@/services/accelevents/sync-types'
import {
  type AirtableRecord,
  optionalText,
  type RecordView,
  requiredChoice,
  requiredLink,
  shapeError,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'

function payloadFrom<T>(source: RecordView, schema: ZodType<T>): { json: string; value: T } {
  const json = text(source, COL.payloadJson)
  let decoded: unknown
  try {
    decoded = JSON.parse(json)
  } catch {
    throw shapeError(source, COL.payloadJson, 'is not valid JSON')
  }
  const parsed = schema.safeParse(decoded)
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0)
    const detail = issue === undefined ? 'unknown payload error' : issue.message
    throw shapeError(source, COL.payloadJson, `does not match the Accelevents contract: ${detail}`)
  }
  return { json, value: parsed.data }
}

/** A log row WITH its snapshotted payload, parsed. What the retry sweep replays. */
export function mapSyncLog(record: AirtableRecord): SyncLogRow {
  const source = view(TABLES.syncLog, record)
  const entityType = requiredChoice(source, COL.entityType, SYNC_ENTITY_TYPES)
  const common = {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    localId: text(source, COL.localId),
    remoteId: optionalText(source, COL.remoteId),
    action: requiredChoice(source, COL.action, SYNC_ACTIONS),
    status: requiredChoice(source, COL.status, SYNC_STATUSES),
    error: optionalText(source, COL.error),
    at: text(source, COL.at),
  }

  if (entityType === 'speaker') {
    const payload = payloadFrom(source, speakerPayloadSchema)
    return { ...common, entityType, payloadJson: payload.json, payload: payload.value }
  }
  if (entityType === 'submission') {
    const payload = payloadFrom(source, sessionPayloadSchema)
    return { ...common, entityType, payloadJson: payload.json, payload: payload.value }
  }
  if (entityType === 'track') {
    const payload = payloadFrom(source, trackPayloadSchema)
    return { ...common, entityType, payloadJson: payload.json, payload: payload.value }
  }
  const payload = payloadFrom(source, tagPayloadSchema)
  return { ...common, entityType, payloadJson: payload.json, payload: payload.value }
}

/**
 * One SyncLog row WITHOUT its payload, for the Integrations page's log table.
 *
 * Deliberately not `SyncLogRow`: that type parses `payloadJson` against the Accelevents
 * contract and throws on a mismatch, which is right for the sweep (an unparseable
 * payload must not be replayed) and wrong for a diagnostic table, where one row written
 * before a payload shape changed would take the whole page down. The page renders no
 * payload column, so it pays none of that cost.
 */
export type SyncLogEntry = {
  id: string
  eventId: string
  entityType: SyncEntityType
  localId: string
  remoteId?: string
  action: SyncAction
  status: SyncStatus
  error?: string
  at: string
}

export function mapSyncLogEntry(record: AirtableRecord): SyncLogEntry {
  const source = view(TABLES.syncLog, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    entityType: requiredChoice(source, COL.entityType, SYNC_ENTITY_TYPES),
    localId: text(source, COL.localId),
    remoteId: optionalText(source, COL.remoteId),
    action: requiredChoice(source, COL.action, SYNC_ACTIONS),
    status: requiredChoice(source, COL.status, SYNC_STATUSES),
    error: optionalText(source, COL.error),
    at: text(source, COL.at),
  }
}

/**
 * A mapping row exactly as stored, so `remoteId` keeps its namespace.
 *
 * This is the shape both the page and the importers want. `accelevents:spk_0001` next to
 * `sessionize:14022` is what tells an organizer which side of the table a row came from,
 * and `findRemoteMapping` in reads-imports.ts looks the row up BY the namespaced key.
 */
export function mapMapping(record: AirtableRecord): IntegrationMapping {
  const source = view(TABLES.integrationMappings, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    entityType: requiredChoice(source, COL.entityType, INTEGRATION_ENTITY_TYPES),
    localId: text(source, COL.localId),
    remoteId: text(source, COL.remoteId),
    requestHash: text(source, COL.requestHash),
    syncedAt: text(source, COL.syncedAt),
  }
}

/**
 * The same row with a bare Accelevents id, or nothing when it belongs to an importer.
 *
 * The push side must never see another provider's row. It matches a mapping on
 * (event, entityType, localId) alone, so a Sessionize id would read as "this entity
 * already exists remotely" and get PUT against the Accelevents API, writing bodo's
 * content over whatever record happens to carry that integer on their side. See
 * remote-id.ts for why an unprefixed row is still ours.
 */
export function toAccelMapping(record: AirtableRecord): IntegrationMapping | undefined {
  const stored = mapMapping(record)
  const remoteId = fromNamespacedRemoteId(stored.remoteId)
  return remoteId === undefined ? undefined : { ...stored, remoteId }
}
