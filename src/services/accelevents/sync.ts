// The forward sync: BUILD_SPEC §5.7's dependency-ordered walk, and the half that was
// missing. `getAccelClient`, `writeSyncLog` and `saveIntegrationMapping` had exactly one
// caller between them (the cron route), so no first SyncLog row was ever written and the
// retry sweep swept a set that stays empty. Everything here exists to write that first row.
//
// Order is the design, not an implementation detail. Tracks and tags, then ticket types,
// then speakers, then sessions: a session references its track, its tags and its cast BY
// REMOTE ID, and those ids do not exist until the entities ahead of it have landed. So
// this is one walk carrying what it has resolved (sync-walk.ts), not four independent calls.
//
// Ticket types are the one phase with nothing to do. Their session payload field
// (`ticketTypesThatCanBeRegistered`) is real and §5.7 lists them in the order, but bodo
// has no ticket-type entity: `INTEGRATION_ENTITY_TYPES` reserves the name and no table
// produces one. The phase is therefore empty rather than absent, and inventing a default
// ticket type to fill it would create registration rows on somebody's live event.
//
// Nothing here talks to Airtable or to the network. sync-wiring.ts binds the real
// boundaries; sync-attempt.ts owns what happens to one entity.
//
// THE COST OF A FULL-EVENT WALK, stated rather than hidden. `push` is per entity all the
// way down: one remote call, one `saveMapping`, one `writeLog`, so two Airtable requests
// per entity and nothing batched anywhere. At §3.1's ~5 requests per second per base, an
// event with 200 accepted sessions and 300 speakers in their casts is about 1,000
// requests, which is minutes of scheduler time inside one Worker invocation. `syncSession`
// and `syncSpeaker`, which are what the accept transition and the Agenda control call, are
// a handful of entities each and are the normal path; `syncEvent` is the button an
// organizer presses once. Batching it would mean a mapping and a log writer that take
// lists, and a walk that no longer resolves each remote id before the next entity needs
// it, which is a different design rather than a tuning change. Until then the honest
// number is: comfortable in the low hundreds of entities, not at a thousand.

import { ACCEPTED_STATUSES } from '@/constants/status'
import {
  describeSubmission,
  type SessionContext,
  sessionPayload,
  speakerPayload,
  tagPayload,
  trackPayload,
} from '@/services/accelevents/sync-payloads'
import {
  type ForwardSyncDeps,
  type ForwardSyncResult,
  openWalk,
  push,
  remoteIds,
  type Walk,
} from '@/services/accelevents/sync-walk'
import type { Speaker, SubmissionWithParticipants, Tag, Track } from '@/types/domain'
import type { Form } from '@/types/forms'

export type {
  EntityCounts,
  ForwardSyncDeps,
  ForwardSyncResult,
} from '@/services/accelevents/sync-walk'

/**
 * The whole event, in dependency order. What the page-level `Sync now` runs.
 *
 * Only ACCEPTED submissions and only the speakers cast in them. Accelevents is the
 * registration platform, so its sessions are the programme an attendee registers for:
 * pushing the pending pile would publish work nobody has decided on, and pushing every
 * speaker who ever submitted would hand a third party the contact details of people the
 * event turned down.
 */
export async function syncEvent(
  deps: ForwardSyncDeps,
  eventId: string,
): Promise<ForwardSyncResult> {
  const walk = await openWalk(deps, eventId)
  const submissions = (await deps.listSubmissions(eventId)).filter((submission) =>
    ACCEPTED_STATUSES.includes(submission.status),
  )

  await pushTaxonomy(walk, await deps.listTracks(eventId), await deps.listTags(eventId))
  await pushSpeakers(walk, castOf(submissions))
  await pushSessions(walk, submissions)
  return walk.result
}

/**
 * One speaker.
 *
 * Takes the event as well as the speaker, which §5.7's `syncSpeaker(speakerId)` does
 * not, because a Speaker in this schema belongs to MANY events (`speakerEventIds` in
 * mapping.ts) and remote ids are event-scoped: the same person at two conferences is two
 * Accelevents records. There is no event to derive, so it is passed.
 */
export async function syncSpeaker(
  deps: ForwardSyncDeps,
  eventId: string,
  speakerId: string,
): Promise<ForwardSyncResult> {
  const walk = await openWalk(deps, eventId)
  await pushSpeakers(walk, [await deps.getSpeaker(speakerId)])
  return walk.result
}

/**
 * One session, its prerequisites first.
 *
 * What the accept transition and the Agenda's per-selection control call. It runs the
 * same ordered walk over just this submission's dependencies, because pushing the
 * session alone would send a payload whose track, tag and speaker ids are missing.
 */
export async function syncSession(
  deps: ForwardSyncDeps,
  submissionId: string,
): Promise<ForwardSyncResult> {
  const submission = await deps.getSubmission(submissionId)
  const walk = await openWalk(deps, submission.eventId)
  const tracks = (await deps.listTracks(submission.eventId)).filter(
    (track) => track.id === submission.trackId,
  )
  const tags = (await deps.listTags(submission.eventId)).filter((tag) =>
    submission.tagIds.includes(tag.id),
  )

  await pushTaxonomy(walk, tracks, tags)
  await pushSpeakers(walk, castOf([submission]))
  await pushSessions(walk, [submission])
  return walk.result
}

async function pushTaxonomy(
  walk: Walk,
  tracks: readonly Track[],
  tags: readonly Tag[],
): Promise<void> {
  for (const track of tracks) {
    await push(walk, { entityType: 'track', localId: track.id, payload: trackPayload(track.name) })
  }
  for (const tag of tags) {
    await push(walk, { entityType: 'tag', localId: tag.id, payload: tagPayload(tag.name) })
  }
}

async function pushSpeakers(walk: Walk, speakers: readonly Speaker[]): Promise<void> {
  for (const speaker of speakers) {
    const payload = speakerPayload(speaker)
    if (payload === undefined) {
      walk.result.blocked += 1
      continue
    }
    await push(walk, { entityType: 'speaker', localId: speaker.id, payload })
  }
}

async function pushSessions(
  walk: Walk,
  submissions: readonly SubmissionWithParticipants[],
): Promise<void> {
  if (submissions.length === 0) return
  const forms = await walk.deps.listForms(walk.eventId)
  const rooms = new Map(
    (await walk.deps.listRooms(walk.eventId)).map((room) => [room.id, room.name] as const),
  )

  for (const submission of submissions) {
    const context = sessionContext(walk, submission, forms, rooms)
    const payload = context === undefined ? undefined : sessionPayload(submission, context)
    if (payload === undefined) {
      walk.result.blocked += 1
      continue
    }
    await push(walk, { entityType: 'submission', localId: submission.id, payload })
  }
}

/** The session's remote references, or nothing when one has not landed. See `remoteIds`. */
function sessionContext(
  walk: Walk,
  submission: SubmissionWithParticipants,
  forms: readonly Form[],
  rooms: ReadonlyMap<string, string>,
): SessionContext | undefined {
  const trackIds = submission.trackId === undefined ? [] : [submission.trackId]
  const trackRemoteIds = remoteIds(walk, 'track', trackIds)
  const tagRemoteIds = remoteIds(walk, 'tag', submission.tagIds)
  const speakerRemoteIds = remoteIds(
    walk,
    'speaker',
    submission.participants.map((participant) => participant.speakerId),
  )
  if (trackRemoteIds === undefined || tagRemoteIds === undefined) return undefined
  if (speakerRemoteIds === undefined) return undefined
  return {
    description: describeSubmission(submission, forms),
    roomName: submission.roomId === undefined ? undefined : rooms.get(submission.roomId),
    trackRemoteIds,
    tagRemoteIds,
    speakerRemoteIds,
  }
}

/** Every speaker cast in these submissions, once each, in first-seen order. */
function castOf(submissions: readonly SubmissionWithParticipants[]): readonly Speaker[] {
  const speakers = new Map<string, Speaker>()
  for (const submission of submissions) {
    for (const participant of submission.participants) {
      if (speakers.has(participant.speakerId)) continue
      speakers.set(participant.speakerId, participant.speaker)
    }
  }
  return [...speakers.values()]
}
