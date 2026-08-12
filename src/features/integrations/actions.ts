'use server'

// The two controls at the bottom of the Accelevents surface: `Sync now` and `Retry failed`.
//
// Both authorize for themselves with `requireIntegrationsAdmin`. A layout is not a
// security boundary (BUILD_SPEC section 4): an action is reachable by POST without the
// settings tree ever rendering, and this page is readable by a reviewer, so the render
// check and the enforcement genuinely disagree by design. Capability comes from
// `EventMemberships` on every call, never from a role baked into the session cookie.
//
// `Retry failed` runs the JOB, not the cron route. Calling `/api/cron/accelevents` from
// here would mean either shipping the cron secret to a place an organizer's request can
// reach it, or loosening `assertCronAuthorized` so a session satisfies it, and the second
// turns the cron guard into something that accepts two unrelated kinds of caller.
// `retryFailedAcceleventsSyncs` takes every boundary as a dependency precisely so this
// entry point can supply its own.
//
// Failures come back as values rather than thrown. A thrown AppError crossing the action
// boundary reaches the browser as a redacted digest, and "this event has no Accelevents
// event URL" is something an organizer can act on once told.

import { ErrorIds } from '@/constants/errorIds'
import { requireIntegrationsAdmin } from '@/features/integrations/authorize'
import { parseAcceleventsMapping } from '@/features/integrations/connection'
import {
  type SyncSummary,
  summarizeRetry,
  summarizeSync,
} from '@/features/integrations/run-summary'
import { retryFailedAcceleventsSyncs } from '@/features/jobs/accelevents-sync'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { getAccelClient } from '@/services/accelevents'
import { syncEvent } from '@/services/accelevents/sync'
import { forwardSyncDeps } from '@/services/accelevents/sync-wiring'
import {
  getAcceleventsEventUrl,
  listEventAcceleventsMappings,
  listFailedSyncLogs,
  saveIntegrationMapping,
  writeSyncLog,
} from '@/services/airtable/accelevents-sync'
import { invalidate } from '@/services/airtable/invalidate'
import { setAcceleventsMapping } from '@/services/airtable/mutations-event'
import { eventIntegrationsTag } from '@/services/airtable/tags'
import { claimOnce } from '@/utils/cf'

export async function syncEventNowAction(input: {
  eventId: string
}): Promise<ActionResult<SyncSummary>> {
  try {
    await requireIntegrationsAdmin(input.eventId)
    const result = await syncEvent(forwardSyncDeps(), input.eventId)
    expire(input.eventId)
    return actionOk(summarizeSync(result))
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * `Connect`: map this event to an Accelevents event.
 *
 * This is the write BUILD_SPEC 5.0d describes as the Connection card's job, and until now
 * nothing in the codebase could perform it: `Events.accelEventUrl` and `accelEventId` were
 * readable everywhere and writable only in Airtable itself, so the button had to sit there
 * disabled explaining that. It is a separate action from the Event Details save because it
 * is integration state rather than event metadata, and because that save polices the slug.
 *
 * The pasted value is normalized rather than stored verbatim (`parseAcceleventsMapping`).
 * `accelEventUrl` is a path SEGMENT despite the name, so an address copied out of a browser
 * would build `/rest/host/event/https://.../speakers` and 404 with nothing on screen to say
 * why. Refusing it would be correct and useless, since the pasted value contains the answer.
 *
 * It does NOT verify the mapping against the far side. That would need a live call on the
 * organizer's request thread, it would fail differently when the key is absent than when the
 * slug is wrong, and `Sync now` already reports both with the entity that failed. Connecting
 * is recording an intent; the first sync is what proves it.
 */
export async function connectAcceleventsAction(input: {
  eventId: string
  eventUrl: string
  remoteEventId: string
}): Promise<ActionResult<{ eventUrl: string }>> {
  try {
    await requireIntegrationsAdmin(input.eventId)
    const parsed = parseAcceleventsMapping(input)
    // Returned as a failure rather than thrown, and carrying the registry id so a log line
    // and the message on screen trace to the same cause. A blank event URL is the
    // organizer's input being wrong, which is exactly what `actionFailure` re-throws rather
    // than flattens, so it is built here instead.
    if (!parsed.ok) {
      return { ok: false, errorId: ErrorIds.SUB_VALIDATION_FAIL, message: parsed.error }
    }

    await setAcceleventsMapping({ eventId: input.eventId, ...parsed.mapping })
    expire(input.eventId)
    return actionOk({ eventUrl: parsed.mapping.eventUrl })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * `Disconnect`: clear the mapping, so nothing is pushed anywhere.
 *
 * It deliberately leaves `IntegrationMappings` and `SyncLog` alone. Those rows are the record
 * of what bodo has already written into the far side, and deleting them would not un-write
 * it: the remote records still exist, and the mapping is the only thing that would let a
 * later reconnect UPDATE them instead of creating duplicates. So disconnecting stops the
 * sync and keeps the evidence, which is also what makes reconnecting safe.
 */
export async function disconnectAcceleventsAction(input: {
  eventId: string
}): Promise<ActionResult<{ disconnected: true }>> {
  try {
    await requireIntegrationsAdmin(input.eventId)
    await setAcceleventsMapping({ eventId: input.eventId })
    expire(input.eventId)
    return actionOk({ disconnected: true as const })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function retryFailedSyncsAction(input: {
  eventId: string
}): Promise<ActionResult<SyncSummary>> {
  try {
    await requireIntegrationsAdmin(input.eventId)
    const result = await retryFailedAcceleventsSyncs(retryDeps(input.eventId))
    expire(input.eventId)
    return actionOk(summarizeRetry(result))
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The retry sweep, narrowed to ONE event.
 *
 * The cron route's version is cross-event on purpose, because one schedule drains the
 * backlog of every event. A button on an event's settings page is the opposite: an
 * organizer pressing `Retry failed` here is asking about the rows they can see in the
 * table above it, and quietly replaying another conference's failures would push records
 * into a third party's system on behalf of somebody who did not press anything.
 *
 * `listFailedSyncLogs` takes no event id, so the filter is applied here rather than at the
 * DAL, which is the sweep's read and must stay unscoped. Both reads stay UNCACHED, which
 * is the property that matters: a job reading its worklist from a cache can be handed the
 * same rows twice, and the mapping list is what decides create versus update.
 */
function retryDeps(eventId: string) {
  return {
    listFailed: async () => (await listFailedSyncLogs()).filter((row) => row.eventId === eventId),
    // Accelevents rows only, ids unprefixed. The unscoped `listIntegrationMappings`
    // carries every provider's rows for the importers' reverse lookup, and a Sessionize
    // id reaching this sweep would be PUT against the Accelevents API.
    listMappings: async () => await listEventAcceleventsMappings(eventId),
    getEventUrl: getAcceleventsEventUrl,
    client: getAccelClient(),
    saveMapping: saveIntegrationMapping,
    writeLog: writeSyncLog,
    now: () => new Date().toISOString(),
    claim: claimOnce,
    // Unique per invocation. `claimOnce` re-grants to the SAME holder on purpose, so that
    // a retry does not deadlock against its own earlier lease, which means a holder
    // derived from anything stable would hand two overlapping callers the same entity.
    holder: crypto.randomUUID(),
  }
}

/**
 * One tag, and it covers all three tables this page reads.
 *
 * `IntegrationMappings`, `SyncLog` and `ImportRuns` are tagged together under
 * `event:{id}:integrations` (tags.ts), because every control here writes to more than one
 * of them and expiring two out of three leaves the page contradicting itself: a mapping
 * with a `syncedAt` from this minute sitting above a log that ends an hour ago.
 *
 * Through `invalidate` rather than `next/cache` directly, per the project rule: one place
 * decides what expiry means, and bare `revalidateTag(tag)` is a type error on 16.2.12.
 */
function expire(eventId: string): void {
  invalidate('action', { own: [eventIntegrationsTag(eventId)] })
}
