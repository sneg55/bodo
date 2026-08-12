// One entity, one push: claim it, decide create vs update vs skip, call, record.
//
// This is the forward twin of `retryOne` in src/features/jobs/accelevents-sync.ts, and
// the two are deliberately NOT one function. The sweep replays a snapshot off a SyncLog
// row and must never rebuild the payload from current state; this builds the payload
// from current state and has no snapshot. What they do share is the part that must not
// diverge, and it is spelled out below rather than abstracted: the claim key, the
// hash-means-skip rule, and a SyncLog row on every attempt.
//
// The claim is the reason both exist at all. A create is not idempotent and the two
// paths overlap by design (an organizer presses `Sync now` while the cron sweep is
// mid-backlog), so without a lock keyed on the ENTITY both would POST and the event
// would end up with two remote sessions and two IntegrationMappings for one submission.
// The second is the worse half: `indexMappings` throws on a duplicate, so every later
// sweep aborts before doing any work and the integration wedges itself.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import type {
  AccelClient,
  RemoteRef,
  SessionPayload,
  SpeakerPayload,
  TaxonomyPayload,
} from '@/services/accelevents/client'
import type {
  IntegrationMapping,
  MappingWrite,
  SyncAction,
  SyncLogWrite,
} from '@/services/accelevents/sync-types'

/**
 * Long enough for a remote call plus its mapping write, shorter than the cron schedule.
 *
 * The same number as `ACCEL_LEASE_MS` in the sweep, and a separate constant rather than
 * an import: a module under `src/services` importing a value out of `src/features`
 * inverts the dependency direction the rest of this directory keeps. They must stay
 * equal, because the two paths claim the same key and a shorter lease on one side would
 * let it steal an entity the other is mid-way through creating.
 */
export const ACCEL_PUSH_LEASE_MS = 120_000

export type AttemptDeps = {
  client: AccelClient
  saveMapping: (write: MappingWrite) => Promise<void>
  writeLog: (write: SyncLogWrite) => Promise<void>
  /** `hashAcceleventsPayload`. Injected so a test can force a hash collision or a miss. */
  hash: (payload: unknown) => Promise<string>
  now: () => string
  /** `claimOnce` from src/utils/cf.ts, backed by the ClaimGuard Durable Object. */
  claim: (key: string, holder: string, ttlMs: number) => Promise<{ granted: boolean }>
  /** Unique per invocation. A shared holder would grant one entity to two callers. */
  holder: string
}

/** What one push did. `contended` is not a failure and is never retried in the same run. */
export type AttemptOutcome = 'created' | 'updated' | 'skipped' | 'failed' | 'contended'

export type AttemptResult = { outcome: AttemptOutcome; remoteId?: string }

type Target = {
  eventId: string
  eventUrl: string
  localId: string
  /** The mapping this entity already has, which is what decides create versus update. */
  mapping: IntegrationMapping | undefined
}

/** Discriminated the way `SyncLogRow` is, so the payload and the calls stay in step. */
export type Attempt = Target &
  (
    | { entityType: 'speaker'; payload: SpeakerPayload }
    | { entityType: 'submission'; payload: SessionPayload }
    | { entityType: 'track' | 'tag'; payload: TaxonomyPayload }
  )

/**
 * The identity a mapping, a claim and a log row are all keyed on.
 *
 * Byte-for-byte the sweep's `identityKey`, and it has to be: the two claim the SAME
 * Durable Object name, so a different serialisation here would silently give each path
 * its own lock and the guard would protect nothing.
 */
export function accelIdentityKey(row: {
  eventId: string
  entityType: string
  localId: string
}): string {
  return JSON.stringify([row.eventId, row.entityType, row.localId])
}

export async function pushEntity(attempt: Attempt, deps: AttemptDeps): Promise<AttemptResult> {
  const requestHash = await deps.hash(attempt.payload)
  const identity = accelIdentityKey(attempt)

  // Accepted already: log the skip and call nothing. Not claimed first, for the sweep's
  // reason: this path creates nothing remote, so making it contend would let one stuck
  // caller hide another's bookkeeping for the length of a lease.
  if (attempt.mapping !== undefined && attempt.mapping.requestHash === requestHash) {
    await deps.writeLog(logWrite(attempt, { action: 'skip', status: 'ok', at: deps.now() }))
    return { outcome: 'skipped', remoteId: attempt.mapping.remoteId }
  }

  const claim = await deps.claim(`accel:${identity}`, deps.holder, ACCEL_PUSH_LEASE_MS)
  if (!claim.granted) return { outcome: 'contended' }

  // A mapping means the entity exists remotely, whatever this local attempt thinks: a
  // create that failed AFTER the remote accepted it leaves exactly that state, and
  // repeating the create would duplicate the entity on their side.
  const action: SyncAction = attempt.mapping === undefined ? 'create' : 'update'

  // Held OUTSIDE the try, and this is the bug that made it necessary: a create whose
  // remote call SUCCEEDED and whose `saveMapping` then failed used to log the failure
  // with `attempt.mapping?.remoteId`, which is absent for a create. The row therefore
  // carried no remote id, the sweep found no mapping either, and the retry posted a
  // SECOND create, duplicating the entity inside somebody else's event with nothing in
  // bodo showing it. What the far side returned is the only proof the entity exists, so
  // it is captured the instant it arrives and carried down both paths.
  let landed = attempt.mapping?.remoteId

  try {
    const remote = await send(attempt, action, deps.client)
    landed = remote.remoteId
    const at = deps.now()
    await deps.saveMapping({
      mappingId: attempt.mapping?.id,
      eventId: attempt.eventId,
      entityType: attempt.entityType,
      localId: attempt.localId,
      remoteId: remote.remoteId,
      requestHash,
      syncedAt: at,
    })
    // The ONE swallowed error in this file, and the asymmetry with the catch below is the
    // point. By here the remote has accepted the entity and its mapping row is written, so
    // the sync HAPPENED: this log row is the diagnostic record of it, not the queue. A 429
    // on it (which Airtable answers with under exactly the load a full-event walk creates)
    // would otherwise be reported as a failure, drop the remote id, and hold back every
    // session that references this entity, over an entity that is sitting on their side
    // correctly. It is reported to `wrangler tail` with an id to grep for instead.
    await deps
      .writeLog(logWrite(attempt, { action, status: 'ok', at, remoteId: remote.remoteId }))
      .catch((error: unknown) => {
        console.error(`[${ErrorIds.DATA_WRITE_FAIL}] accelevents sync log not written`, error)
      })
    return { outcome: action === 'create' ? 'created' : 'updated', remoteId: remote.remoteId }
  } catch (error) {
    // The failed row IS the retry queue: `listFailedSyncLogs` picks it up, re-hashes the
    // payload it carries, and the cron sweep replays it. So this write is not diagnostics,
    // and a throw from it means the attempt is lost rather than queued. It is left to
    // escape to the walk, which counts the entity and moves on, exactly as the sweep's
    // per-row guard does.
    await deps.writeLog(
      logWrite(attempt, {
        action,
        status: 'failed',
        at: deps.now(),
        // `landed`, never `attempt.mapping?.remoteId`. A row that names the remote id is
        // what tells `chooseRemoteAction` the create already happened, so the replay is
        // an update; without it the sweep repeats the create.
        remoteId: landed,
        error: describe(error),
      }),
    )
    // Returned even on the failure path, because the entity IS on the far side: the walk
    // records it in `resolved`, so a session that references this speaker can still be
    // sent with the right cast instead of being held back behind a bookkeeping failure.
    return { outcome: 'failed', remoteId: landed }
  }
}

async function send(attempt: Attempt, action: SyncAction, client: AccelClient): Promise<RemoteRef> {
  const remoteId = attempt.mapping?.remoteId
  if (attempt.entityType === 'speaker') {
    if (remoteId === undefined)
      return await createSpeaker(attempt.payload, attempt.eventUrl, client)
    return await client.updateSpeaker(attempt.eventUrl, remoteId, attempt.payload)
  }
  if (attempt.entityType === 'submission') {
    if (remoteId === undefined) return await client.createSession(attempt.eventUrl, attempt.payload)
    return await client.updateSession(attempt.eventUrl, remoteId, attempt.payload)
  }
  if (remoteId === undefined) return await client.createTaxonomy(attempt.eventUrl, attempt.payload)

  // Neither the client nor the mock exposes a taxonomy update, and inventing an endpoint
  // here is not the fix. Sending the create again would duplicate the remote tag, which
  // is worse than the rename staying a visible failed attempt. `action` is named in the
  // error so the log row says which call was refused.
  throw new AppError(ErrorIds.ACCEL_BAD_REQUEST, 'taxonomy update is not in the client contract', {
    entityType: attempt.entityType,
    localId: attempt.localId,
    action,
  })
}

/**
 * A speaker create that collides on email is a success, not a failure.
 *
 * §5.7's duplicate-email branch: their error 4068906 (`DUPLICATE_EMAIL_CODE`, turned
 * into `ACCEL_DUPLICATE_EMAIL` by the client) means "a speaker with this address is
 * already on this event", and that speaker is the one this mapping wants. Without the
 * lookup a speaker who exists remotely can never be mapped, so every run retries the
 * same create forever and no session can reference them.
 */
async function createSpeaker(
  payload: SpeakerPayload,
  eventUrl: string,
  client: AccelClient,
): Promise<RemoteRef> {
  try {
    return await client.createSpeaker(eventUrl, payload)
  } catch (error) {
    if (!isAppError(error) || error.id !== ErrorIds.ACCEL_DUPLICATE_EMAIL) throw error

    const remoteId = await client.findSpeakerByEmail(eventUrl, payload.email)
    if (remoteId === undefined) {
      // They said the address exists and then could not find it. Guessing an id here
      // would write a mapping that points at nothing and turn every later update into a
      // write against some other event's speaker.
      throw new AppError(
        ErrorIds.ACCEL_BAD_REQUEST,
        'duplicate speaker email could not be resolved to a remote id',
        { eventUrl, email: payload.email },
      )
    }
    return { remoteId, existed: true }
  }
}

type LogDetails = {
  action: SyncAction
  status: 'ok' | 'failed'
  at: string
  remoteId?: string
  error?: string
}

function logWrite(attempt: Attempt, details: LogDetails): SyncLogWrite {
  return {
    eventId: attempt.eventId,
    entityType: attempt.entityType,
    localId: attempt.localId,
    remoteId: details.remoteId ?? attempt.mapping?.remoteId,
    action: details.action,
    status: details.status,
    payload: attempt.payload,
    error: details.error,
    at: details.at,
  }
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
