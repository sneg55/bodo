// The agenda surface's read: six DAL calls and a projection.
//
// This was a `'use cache'` function with its own `cacheTag` and `cacheLife`. Cache
// Components is off now (next.config.ts says why the adapter forced that), so caching
// and tagging live in the Airtable client underneath these six calls instead. There is
// nothing to compose here any more, and `cacheTag()` throws without the flag.

import {
  sessionFormatLabel,
  sessionLanguageLabel,
  sessionLevelLabel,
} from '@/features/submissions/session-vocabulary'
import {
  getEvent,
  listForms,
  listRooms,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import type { Event, Room, SubmissionWithParticipants, Tag, Track } from '@/types/domain'
import type { Form } from '@/types/forms'

import type { AgendaData, AgendaParticipant, AgendaSession } from './types'

export async function getAgendaData(eventId: string): Promise<AgendaData> {
  const [event, submissions, rooms, tracks, tags, forms] = await Promise.all([
    getEvent(eventId),
    listSubmissions(eventId),
    listRooms(eventId),
    listTracks(eventId),
    listTags(eventId),
    listForms(eventId),
  ])

  return projectAgendaData({ event, submissions, rooms, tracks, tags, forms })
}

type AgendaSource = {
  event: Event
  submissions: readonly SubmissionWithParticipants[]
  rooms: readonly Room[]
  tracks: readonly Track[]
  tags: readonly Tag[]
  forms: readonly Form[]
}

type ProjectionLookups = {
  rooms: ReadonlyMap<string, string>
  tracks: ReadonlyMap<string, string>
  tags: ReadonlyMap<string, string>
  forms: ReadonlyMap<string, string>
}

export function projectAgendaData(source: AgendaSource): AgendaData {
  const { event, submissions, rooms, tracks, tags, forms } = source
  const roomById = new Map(rooms.map((room) => [room.id, room.name]))
  const trackById = new Map(tracks.map((track) => [track.id, track.name]))
  const tagById = new Map(tags.map((tag) => [tag.id, tag.name]))
  const formById = new Map(forms.map((form) => [form.id, form.name]))
  const lookups = { rooms: roomById, tracks: trackById, tags: tagById, forms: formById }
  const sessions = submissions
    .filter((submission) => submission.status === 'accepted')
    .map((submission) => projectSession(submission, lookups))
  const speakerById = new Map<string, AgendaParticipant>()

  for (const session of sessions) {
    for (const participant of session.participants) {
      // The role is deliberately dropped here. This is the event's deduplicated cast for
      // the Add Session picker, and a role belongs to one person on one session: carrying
      // it over would label somebody a chairperson because that is the last session the
      // loop happened to see them on.
      speakerById.set(participant.id, { id: participant.id, name: participant.name })
    }
  }

  return {
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      timezone: event.timezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      capacity: room.capacity,
    })),
    sessions,
    speakers: [...speakerById.values()].sort((left, right) => left.name.localeCompare(right.name)),
  }
}

function projectSession(
  submission: SubmissionWithParticipants,
  lookups: ProjectionLookups,
): AgendaSession {
  return {
    id: submission.id,
    code: submission.code,
    title: submission.title,
    status: submission.status,
    source: submission.source,
    sourceName:
      submission.source === 'manual'
        ? 'Manual'
        : (optionalLookup(lookups.forms, submission.formId) ?? 'Form'),
    // The human label, never the stored key. `format`, `level` and `language` are Airtable
    // single-selects over fixed vocabularies, so the record holds `talk` and every screen
    // printed `talk`. Render-time only: nothing here writes, and the stored value stays
    // canonical because an undeclared choice rejects the whole record with a 422.
    format: sessionFormatLabel(submission.format),
    level: sessionLevelLabel(submission.level),
    language: sessionLanguageLabel(submission.language),
    ceuCredits: submission.ceuCredits,
    track: optionalLookup(lookups.tracks, submission.trackId),
    tags: submission.tagIds.flatMap((tagId) => {
      const name = lookups.tags.get(tagId)
      return name === undefined ? [] : [name]
    }),
    roomId: submission.roomId,
    room: optionalLookup(lookups.rooms, submission.roomId),
    startsAt: submission.startsAt,
    endsAt: submission.endsAt,
    scheduleStatus: submission.scheduleStatus,
    // The second gate on the public page, carried so the list can say when a published row
    // is still being withheld. See `publicWithholding`.
    contentStatus: submission.contentStatus,
    capacity: submission.capacity,
    location: submission.location,
    clientSessionId: submission.clientSessionId,
    notifiedAt: submission.notifiedAt,
    submittedAt: submission.submittedAt,
    participants: submission.participants.map((participant) => ({
      id: participant.speakerId,
      name: `${participant.speaker.firstName} ${participant.speaker.lastName}`.trim(),
      role: participant.role,
    })),
  }
}

function optionalLookup(
  values: ReadonlyMap<string, string>,
  id: string | undefined,
): string | undefined {
  return id === undefined ? undefined : values.get(id)
}
