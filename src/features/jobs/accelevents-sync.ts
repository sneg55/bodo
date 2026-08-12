// Retry failed Accelevents attempts from their SyncLog snapshots.
//
// The request hash check happens before the remote call. A prior run can accept a
// payload and save its IntegrationMapping while failing to append the success log.
// The next run still sees a failed row, but the matching hash turns it into a skip
// instead of sending the accepted request twice.
//
// Every boundary is a dependency because the schedule and the future admin retry
// button must call this same function, and neither entry should own retry policy.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { chooseRemoteAction, retryRemote } from '@/features/jobs/accelevents-remote'
import type { AccelClient, RemoteRef } from '@/services/accelevents/client'
import type {
  FailedSyncRow,
  IntegrationMapping,
  MappingWrite,
  SyncAction,
  SyncLogWrite,
} from '@/services/accelevents/sync-types'

export type AcceleventsSyncDeps = {
  listFailed: () => Promise<readonly FailedSyncRow[]>
  listMappings: () => Promise<readonly IntegrationMapping[]>
  getEventUrl: (eventId: string) => Promise<string>
  client: AccelClient
  saveMapping: (write: MappingWrite) => Promise<void>
  writeLog: (write: SyncLogWrite) => Promise<void>
  now: () => string
  /**
   * `claimOnce` from src/utils/cf.ts, the same Durable Object the outbox drain uses.
   *
   * Needed because a create retry is not idempotent and this sweep can overlap itself: two
   * runs seeing one failed create with no mapping would both POST, producing a duplicate
   * remote session and two IntegrationMappings for one entity. The second consequence is
   * the worse one, because `indexMappings` throws on a duplicate and every later sweep
   * then aborts before doing any work at all, so the integration wedges itself.
   *
   * Airtable cannot express the uniqueness that would prevent it and the Accelevents API
   * offers no dedupe key, so the guard has to be ours.
   */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /** Unique per invocation. A shared holder would grant the same row to both sweeps. */
  holder: string
}

export type AcceleventsSyncResult = {
  found: number
  retried: number
  succeeded: number
  skipped: number
  failed: number
  /** Rows another sweep already held. Not an error, and not retried in this run. */
  contended: number
}

/** Long enough to cover a remote call plus its mapping write, shorter than the schedule. */
export const ACCEL_LEASE_MS = 120_000

type OneResult = { retried: boolean; outcome: 'succeeded' | 'skipped' | 'failed' }
type LogDetails = {
  action: SyncAction
  status: 'ok' | 'failed'
  at: string
  remoteId?: string
  error?: string
}

export async function retryFailedAcceleventsSyncs(
  deps: AcceleventsSyncDeps,
): Promise<AcceleventsSyncResult> {
  const [failed, mappings] = await Promise.all([deps.listFailed(), deps.listMappings()])
  const mappingByEntity = indexMappings(mappings)
  const eventUrls = new Map<string, string>()
  const rows = [...failed].sort((left, right) => priority(left) - priority(right))
  const result: AcceleventsSyncResult = {
    found: rows.length,
    retried: 0,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    contended: 0,
  }

  for (const row of rows) {
    const mapping = mappingByEntity.get(identityKey(row))

    // Claimed per ENTITY, not per SyncLog row, because the thing that must not happen
    // twice is one remote create for one local record. The key is the same identity
    // `indexMappings` uses, so a second sweep is refused for exactly the entity a first
    // sweep is mid-way through creating.
    //
    // Skipped for a row that is only going to write a skip log: that path calls nothing
    // remote and creates nothing, so making it contend would let one stuck sweep hide
    // another sweep's bookkeeping for two minutes.
    const wouldSkip = mapping?.requestHash === row.requestHash
    if (!wouldSkip) {
      const claim = await deps.claim(`accel:${identityKey(row)}`, deps.holder, ACCEL_LEASE_MS)
      if (!claim.granted) {
        result.contended += 1
        continue
      }
    }

    // `retried` means "Accelevents was called", so it is false when the row was going to
    // be skipped anyway. A matching-hash row whose skip log gets a 429 reached no remote
    // API at all, and counting it as a retry would overstate the traffic this sweep sent
    // to the integration, which is the one number the counts exist to report.
    const one = await retryOne(row, mapping, eventUrls, deps).catch((): OneResult => {
      return { retried: !wouldSkip, outcome: 'failed' }
    })
    if (one.retried) result.retried += 1
    if (one.outcome === 'succeeded') result.succeeded += 1
    if (one.outcome === 'skipped') result.skipped += 1
    if (one.outcome === 'failed') result.failed += 1
  }

  return result
}

function indexMappings(
  mappings: readonly IntegrationMapping[],
): ReadonlyMap<string, IntegrationMapping> {
  const indexed = new Map<string, IntegrationMapping>()
  for (const mapping of mappings) {
    const key = identityKey(mapping)
    if (indexed.has(key)) {
      throw new AppError(ErrorIds.DATA_SHAPE_INVALID, 'duplicate Accelevents mapping', {
        eventId: mapping.eventId,
        entityType: mapping.entityType,
        localId: mapping.localId,
      })
    }
    indexed.set(key, mapping)
  }
  return indexed
}

function identityKey(row: { eventId: string; entityType: string; localId: string }): string {
  return JSON.stringify([row.eventId, row.entityType, row.localId])
}

function priority(row: FailedSyncRow): number {
  if (row.entityType === 'track' || row.entityType === 'tag') return 0
  if (row.entityType === 'speaker') return 1
  return 2
}

async function retryOne(
  row: FailedSyncRow,
  mapping: IntegrationMapping | undefined,
  eventUrls: Map<string, string>,
  deps: AcceleventsSyncDeps,
): Promise<OneResult> {
  if (mapping?.requestHash === row.requestHash) {
    return await recordSkip(row, mapping, deps)
  }

  let action: SyncAction = row.action
  try {
    action = chooseRemoteAction(row, mapping)
    const eventUrl = await eventUrlFor(row.eventId, eventUrls, deps)
    const remote = await retryRemote({ row, mapping, action, eventUrl, client: deps.client })
    const at = deps.now()
    await deps.saveMapping({
      mappingId: mapping?.id,
      eventId: row.eventId,
      entityType: row.entityType,
      localId: row.localId,
      remoteId: remote.remoteId,
      requestHash: row.requestHash,
      syncedAt: at,
    })
    await deps.writeLog(logWrite(row, { action, status: 'ok', at, remoteId: remote.remoteId }))
    return { retried: true, outcome: 'succeeded' }
  } catch (error) {
    await deps.writeLog(
      logWrite(row, {
        action,
        status: 'failed',
        at: deps.now(),
        remoteId: mapping?.remoteId ?? row.remoteId,
        error: describe(error),
      }),
    )
    return { retried: true, outcome: 'failed' }
  }
}

async function recordSkip(
  row: FailedSyncRow,
  mapping: IntegrationMapping,
  deps: AcceleventsSyncDeps,
): Promise<OneResult> {
  // No try/catch here on purpose. This writes ONE log row, so a handler could only
  // retry the call that just failed, with the same arguments, against the same table.
  // The earlier version did exactly that and then let the second failure escape, which
  // took the rest of the sweep with it. A throw now reaches the per-row guard in
  // `retryFailedAcceleventsSyncs`, which counts the row and moves on.
  await deps.writeLog(
    logWrite(row, {
      action: 'skip',
      status: 'ok',
      at: deps.now(),
      remoteId: mapping.remoteId,
    }),
  )
  return { retried: false, outcome: 'skipped' }
}

/**
 * The event's Accelevents URL, memoised per sweep.
 *
 * A backlog is usually many rows for one event, and this value is a lookup that does not
 * change while the sweep runs, so reading it per row would spend the Airtable budget the
 * retries need.
 */
async function eventUrlFor(
  eventId: string,
  cache: Map<string, string>,
  deps: AcceleventsSyncDeps,
): Promise<string> {
  const found = cache.get(eventId)
  if (found !== undefined) return found
  const loaded = await deps.getEventUrl(eventId)
  cache.set(eventId, loaded)
  return loaded
}

function logWrite(row: FailedSyncRow, details: LogDetails): SyncLogWrite {
  return {
    eventId: row.eventId,
    entityType: row.entityType,
    localId: row.localId,
    remoteId: details.remoteId,
    action: details.action,
    status: details.status,
    payload: row.payload,
    error: details.error,
    at: details.at,
  }
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
