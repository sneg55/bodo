// One embed, as data rather than as markup. The shape every non-styled format serializes.
//
// The four feeds (basic HTML, JSON, XML, iCal) must answer with the SAME content the rendered
// embed shows, and the way to guarantee that is to build them all off the projection the page
// itself renders (./projection) rather than off a second read with a second set of rules. So
// this module takes an `EmbedProjection` and flattens it; it decides nothing about visibility
// and nothing about filtering, because both have already happened:
//
//   - `publicAgendaRows` has dropped everything unpublished, unaccepted or cancelled.
//   - `applyEmbedFilters` has applied the organizer's Filters section.
//   - `visibleEmbedFields` has resolved the Field Options selection into `projection.fields`.
//
// The last one is the one worth stating, because it is the difference between a feed and a leak:
// a JSON endpoint that dumped every column would publish the fields an organizer switched OFF,
// and a track filter that holds on the HTML page and not on `.json` would be the same defect
// wearing a content type. Every optional value below is gated on `projection.fields`, which is
// the same set the cards render from.
//
// FLAT, not day-grouped. The grouped views carry a day heading per session instead, which loses
// nothing (the grouping is recoverable from the labels) and means one shape serves all four
// serializers plus the calendar, rather than each one branching on the view.

import type { EmbedBody, EmbedProjection } from '@/features/cms/projection'
import type { EmbedView } from '@/types/cms'

export type EmbedFeedSession = {
  id: string
  title: string
  /** The day heading this session sits under. The Session card prints its own date. */
  day?: string
  /** Formatted per the embed's `Date/Time Format`, in the EVENT's timezone. */
  time?: string
  /** The raw instants, so a consumer can re-format or put them in a calendar. */
  startsAt?: string
  endsAt?: string
  /**
   * `Keynote`, `Workshop`, already labelled for display. Absent when the submission carries none.
   *
   * A LOCKED field on both the Agenda and the Session card, so a consumer can rely on it being
   * here whenever the row has one. It was missing from all three of these formats while the
   * styled widget drew the badge, which made the feeds a lossy copy of the page they mirror.
   */
  format?: string
  room?: string
  track?: string
  speakers?: readonly string[]
  /** SANITIZED HTML, not text: `describeSessions` cleans it on the way out of the read. */
  description?: string
}

/** One of a speaker's sessions, as the roster views list them. */
export type EmbedFeedSpeakerSession = {
  id: string
  title: string
  /** The date, pre-formatted in the event's timezone and the organizer's chosen format. */
  when?: string
  room?: string
}

export type EmbedFeedSpeaker = {
  id: string
  name: string
  tagline?: string
  company?: string
  headshotUrl?: string
  /** SANITIZED HTML, like `description` above: `embedSpeakers` cleans it at the read. */
  bio?: string
  /** This speaker's public sessions, in schedule order. */
  sessions?: readonly EmbedFeedSpeakerSession[]
}

export type EmbedFeed = {
  event: string
  view: EmbedView
  viewLabel: string
  /** When the feed was serialized, as an ISO instant. Passed in, so this stays pure. */
  generatedAt: string
  sessions: readonly EmbedFeedSession[]
  speakers: readonly EmbedFeedSpeaker[]
}

/**
 * The projection as a feed.
 *
 * A session-shaped view yields sessions and no speakers; a roster view yields speakers and no
 * sessions. That mirrors what the embed IS: a speaker gallery is not a schedule, and inventing
 * the other half here would publish more than the organizer configured.
 */
export function embedFeed(projection: EmbedProjection, generatedAt: string): EmbedFeed {
  return {
    event: projection.eventName,
    view: projection.view,
    viewLabel: projection.viewLabel,
    generatedAt,
    sessions: feedSessions(projection.body, projection.fields),
    speakers: feedSpeakers(projection.body, projection.fields),
  }
}

function feedSessions(body: EmbedBody, fields: ReadonlySet<string>): readonly EmbedFeedSession[] {
  switch (body.view) {
    case 'agenda':
    case 'schedule_itinerary':
      return body.days.flatMap((day) =>
        day.sessions.map((session) => feedSession(session, day.label, fields)),
      )
    case 'session_list':
      return body.sessions.map((session) => feedSession(session, session.dayLabel, fields))
    case 'speaker_list':
    case 'speaker_gallery':
      return []
  }
}

function feedSpeakers(body: EmbedBody, fields: ReadonlySet<string>): readonly EmbedFeedSpeaker[] {
  switch (body.view) {
    case 'speaker_list':
    case 'speaker_gallery':
      return body.speakers.map((speaker) => ({
        id: speaker.id,
        // `name` is the Speaker card's required field, so it is never gated.
        name: speaker.name,
        ...pick(fields, 'tagline', 'tagline', speaker.tagline),
        ...pick(fields, 'company', 'company', speaker.company),
        ...pick(fields, 'headshot', 'headshotUrl', speaker.headshotUrl),
        ...pick(fields, 'about', 'bio', speaker.bio),
        ...(fields.has('sessions')
          ? {
              sessions: speaker.sessions.map((session) => ({
                id: session.id,
                title: session.title,
                ...optional('when', session.when),
                ...optional('room', session.room),
              })),
            }
          : {}),
      }))
    case 'agenda':
    case 'schedule_itinerary':
    case 'session_list':
      return []
  }
}

/** What both session shapes have in common. `PublicSession` and `EmbedFlatSession` satisfy it. */
type SessionSource = {
  id: string
  title: string
  time?: string
  startsAt?: string
  endsAt?: string
  format?: string
  room?: string
  track?: string
  speakers: readonly string[]
  description?: string
}

function feedSession(
  session: SessionSource,
  day: string,
  fields: ReadonlySet<string>,
): EmbedFeedSession {
  // `time` gates the formatted label AND the raw instants together, because they are the same
  // fact twice: an organizer who turned the time off has not published a start, and a feed that
  // withheld the label while emitting the timestamp would be honouring the switch in name only.
  const timed = fields.has('time')
  return {
    id: session.id,
    title: session.title,
    ...(day === '' ? {} : { day }),
    ...(timed ? optional('time', session.time) : {}),
    ...(timed ? optional('startsAt', session.startsAt) : {}),
    ...(timed ? optional('endsAt', session.endsAt) : {}),
    // Gated like every other optional value, although `format` is a REQUIRED field on both cards
    // and so is always in the set. Gating it anyway is what keeps this function's rule uniform:
    // every value here answers to `projection.fields`, and a field that opted out of that check
    // is the one nobody notices when its tier changes.
    ...pick(fields, 'format', 'format', session.format),
    ...pick(fields, 'room', 'room', session.room),
    ...pick(fields, 'track', 'track', session.track),
    ...(fields.has('speakers') && session.speakers.length > 0
      ? { speakers: session.speakers }
      : {}),
    ...pick(fields, 'description', 'description', session.description),
  }
}

/** One optional value, present only when its Field Options key is switched on and it exists. */
function pick<K extends string>(
  fields: ReadonlySet<string>,
  key: string,
  as: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return fields.has(key) ? optional(as, value) : {}
}

function optional<K extends string>(as: K, value: string | undefined): Partial<Record<K, string>> {
  // An absent key rather than a null, so a consumer's `in` check and our XML and HTML writers
  // all agree on what "not published" looks like.
  return value === undefined || value.trim() === ''
    ? {}
    : ({ [as]: value } as Partial<Record<K, string>>)
}

/** The JSON representation. Indented, because a feed URL is something a human opens first. */
export function embedFeedJson(feed: EmbedFeed): string {
  return `${JSON.stringify(feed, undefined, 2)}\n`
}
