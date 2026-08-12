// What `/api/v1` and the MCP server both read. One module, so the two transports cannot
// disagree about what a session is or about who is allowed to see one.
//
// **The visibility rule is here and only here.** `listPublishedAgenda` is the read that
// enforces `published` + accepted + uncancelled + content-approved, which BUILD_SPEC:984
// binds the public API to as well as the embeds. Calling `listSubmissions` directly from a
// route would quietly expose a half-built schedule, and it would look identical in review.

import type { ApiEvent, ApiSession, ApiSpeaker } from '@/features/api/resources'
import { apiEvent, apiSession, apiSpeaker } from '@/features/api/resources'
import {
  getEvent,
  getEventBySlug,
  listPublishedAgenda,
  listRooms,
  listSpeakers,
  listTracks,
} from '@/services/airtable/queries'

/**
 * The event a slug names, but only if this caller holds a membership on it.
 *
 * Returns `undefined` for both "no such event" and "not yours", which is what lets the route
 * answer 404 to each. A 403 for the second would confirm that a slug is real, turning the
 * endpoint into a way to enumerate other organizers' events.
 */
export async function readApiEvent(
  slug: string,
  eventIds: readonly string[],
): Promise<ApiEvent | undefined> {
  const event = await getEventBySlug(slug)
  if (event === undefined || !eventIds.includes(event.id)) return undefined
  return apiEvent(event)
}

/** Every event this token reaches, by the owner's memberships. */
export async function readApiEvents(eventIds: readonly string[]): Promise<readonly ApiEvent[]> {
  const events = await Promise.all(eventIds.map(async (id) => await getEvent(id)))
  return events.map(apiEvent).toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * The published schedule, in start order, with room and track resolved to names.
 *
 * Rooms and tracks are read once each and turned into lookups, rather than resolved per row.
 * A 200-session conference would otherwise issue 400 extra reads to render one response,
 * which is the fan-out BUILD_SPEC 3.1 exists to forbid.
 */
export async function readApiSessions(eventId: string): Promise<readonly ApiSession[]> {
  const [sessions, rooms, tracks] = await Promise.all([
    listPublishedAgenda(eventId),
    listRooms(eventId),
    listTracks(eventId),
  ])
  const roomName = new Map(rooms.map((room) => [room.id, room.name]))
  const trackName = new Map(tracks.map((track) => [track.id, track.name]))

  return sessions.map((session) =>
    apiSession(session, {
      room: (id) => roomName.get(id),
      track: (id) => trackName.get(id),
    }),
  )
}

/**
 * The speakers on the PUBLISHED schedule, not the whole roster.
 *
 * This is a deliberate narrowing and the reason is disclosure, not tidiness: an organizer who
 * has not announced their lineup has one endpoint protecting it (`readApiSessions` above), and
 * a roster endpoint beside it that answered with every accepted-but-unpublished speaker would
 * hand back the same secret through a different door. The two surfaces agree by construction
 * because this one is derived from that one.
 */
export async function readApiSpeakers(eventId: string): Promise<readonly ApiSpeaker[]> {
  const [sessions, speakers] = await Promise.all([
    listPublishedAgenda(eventId),
    listSpeakers(eventId),
  ])
  const onSchedule = new Set(
    sessions.flatMap((session) => session.participants.map((p) => p.speakerId)),
  )

  return speakers
    .filter((speaker) => onSchedule.has(speaker.id))
    .map(apiSpeaker)
    .toSorted((a, b) => a.name.localeCompare(b.name))
}
