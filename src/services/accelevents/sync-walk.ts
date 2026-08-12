// What one forward walk carries: its dependencies, its resolved remote ids, its counts.
//
// Split from sync.ts, which owns the ORDER (tracks and tags, then ticket types, then
// speakers, then sessions) and the three entry points. This owns the state that order
// threads through, and the split is what keeps either file readable: the walk's job is
// to answer "what is this entity's remote id" and "what has happened so far", and the
// phases above should read as the dependency order and nothing else.
//
// Every boundary is a dependency because three callers run this walk (the accept
// transition, the page's `Sync now`, the Agenda's per-selection `Sync to Accelevents`)
// and none of them should own sync policy. It is the same shape the retry job uses, for
// the same reason, and it is what lets both be tested without a network.

import type { SessionPayload, SpeakerPayload, TaxonomyPayload } from '@/services/accelevents/client'
import {
  type Attempt,
  type AttemptDeps,
  type AttemptResult,
  accelIdentityKey,
  pushEntity,
} from '@/services/accelevents/sync-attempt'
import type { IntegrationMapping, SyncEntityType } from '@/services/accelevents/sync-types'
import type { Room, Speaker, SubmissionWithParticipants, Tag, Track } from '@/types/domain'
import type { Form } from '@/types/forms'

export type ForwardSyncDeps = AttemptDeps & {
  /** `Events.accelEventUrl`, which every REST path is built from. Throws when absent. */
  getIdentity: (eventId: string) => Promise<{ eventUrl: string }>
  /** Accelevents rows for ONE event, ids bare. Uncached: it decides create vs update. */
  listMappings: (eventId: string) => Promise<readonly IntegrationMapping[]>
  getSpeaker: (speakerId: string) => Promise<Speaker>
  getSubmission: (submissionId: string) => Promise<SubmissionWithParticipants>
  listSubmissions: (eventId: string) => Promise<readonly SubmissionWithParticipants[]>
  listTracks: (eventId: string) => Promise<readonly Track[]>
  listTags: (eventId: string) => Promise<readonly Tag[]>
  listRooms: (eventId: string) => Promise<readonly Room[]>
  /** Only to find the Description field id per form. See `describeSubmission`. */
  listForms: (eventId: string) => Promise<readonly Form[]>
}

export type EntityCounts = {
  created: number
  updated: number
  skipped: number
  failed: number
  /** Held by another caller's claim. Not an error, and not retried in this run. */
  contended: number
}

export type ForwardSyncResult = {
  eventId: string
  counts: Record<SyncEntityType, EntityCounts>
  /**
   * Entities that could not be sent AND could not be logged, so nothing queued them.
   *
   * Two causes, both structural rather than remote: a payload the contract cannot
   * express (an accepted session with no room and time, a speaker with no address), and
   * a prerequisite with no remote id yet. Neither can be written to SyncLog, because a
   * row whose `payloadJson` fails `sessionPayloadSchema` makes `mapSyncLog` throw and
   * the sweep maps every row before it filters: one such row would abort every later
   * retry for every event. So the count is the report, and the fix is upstream.
   */
  blocked: number
}

export type Walk = {
  deps: ForwardSyncDeps
  eventId: string
  eventUrl: string
  /** By identity key, as read at the start. What decides create versus update. */
  mappings: ReadonlyMap<string, IntegrationMapping>
  /** Remote ids known to exist, seeded from the mappings and grown as the walk lands. */
  resolved: Map<string, string>
  result: ForwardSyncResult
}

export type PushItem =
  | { entityType: 'speaker'; localId: string; payload: SpeakerPayload }
  | { entityType: 'submission'; localId: string; payload: SessionPayload }
  | { entityType: 'track' | 'tag'; localId: string; payload: TaxonomyPayload }

export async function openWalk(deps: ForwardSyncDeps, eventId: string): Promise<Walk> {
  const { eventUrl } = await deps.getIdentity(eventId)
  const mappings = new Map<string, IntegrationMapping>()
  const resolved = new Map<string, string>()
  for (const mapping of await deps.listMappings(eventId)) {
    const key = accelIdentityKey(mapping)
    mappings.set(key, mapping)
    // A mapping IS the proof the entity exists remotely, so a session may reference it
    // even when this walk skips the entity itself as unchanged.
    resolved.set(key, mapping.remoteId)
  }
  return { deps, eventId, eventUrl, mappings, resolved, result: emptyResult(eventId) }
}

export async function push(walk: Walk, item: PushItem): Promise<void> {
  const key = accelIdentityKey({
    eventId: walk.eventId,
    entityType: item.entityType,
    localId: item.localId,
  })
  const attempt: Attempt = {
    ...item,
    eventId: walk.eventId,
    eventUrl: walk.eventUrl,
    mapping: walk.mappings.get(key),
  }

  // The same per-entity guard the sweep has, and for the same reason: the throw that
  // reaches here is a failed SyncLog write, which Airtable answers with a 429 under
  // exactly the load a full-event walk creates. Letting it escape would abandon every
  // remaining entity in the walk, silently and mid-order.
  const result = await pushEntity(attempt, walk.deps).catch(
    (): AttemptResult => ({ outcome: 'failed' }),
  )
  if (result.remoteId !== undefined) walk.resolved.set(key, result.remoteId)

  const counts = walk.result.counts[item.entityType]
  if (result.outcome === 'created') counts.created += 1
  if (result.outcome === 'updated') counts.updated += 1
  if (result.outcome === 'skipped') counts.skipped += 1
  if (result.outcome === 'failed') counts.failed += 1
  if (result.outcome === 'contended') counts.contended += 1
}

/**
 * The remote ids for a set of local records, or nothing when one has not landed.
 *
 * All-or-nothing, and the caller holds its session back on `undefined`. A create that
 * silently drops the co-presenter whose push failed publishes a session with the wrong
 * cast on a page attendees read, and the local record then looks synced. Holding it back
 * leaves the failed prerequisite as the one visible problem, the sweep retries it, and
 * the next walk sends the session whole.
 */
export function remoteIds(
  walk: Walk,
  entityType: SyncEntityType,
  localIds: readonly string[],
): readonly string[] | undefined {
  const found: string[] = []
  for (const localId of localIds) {
    const remoteId = walk.resolved.get(
      accelIdentityKey({ eventId: walk.eventId, entityType, localId }),
    )
    if (remoteId === undefined) return undefined
    found.push(remoteId)
  }
  return found
}

function emptyResult(eventId: string): ForwardSyncResult {
  const zero = (): EntityCounts => ({
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    contended: 0,
  })
  return {
    eventId,
    counts: { track: zero(), tag: zero(), speaker: zero(), submission: zero() },
    blocked: 0,
  }
}
