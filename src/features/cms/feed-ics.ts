// The `.ics` representation: the embed's sessions as a subscribable calendar.
//
// Nothing here writes iCalendar. `buildSessionCalendar` (@/features/comms/ics) does, and it is
// the same builder the visitor's starred-schedule export uses, so the escaping, the 75-octet
// folding, the UID shape and the UTC stamps are one implementation with one set of tests rather
// than a second copy that drifts until some client refuses the file.
//
// What IS decided here is which sessions go in, and the answer is the same feed every other
// format serializes (./feed-model): the organizer's Filters have already narrowed the rows and
// their Field Options have already decided whether a room or an abstract is published, so a
// calendar cannot carry a track the JSON hides, and a session whose `room` was switched off gets
// no LOCATION. A speaker-roster embed yields no sessions and therefore an empty VCALENDAR, which
// is a valid document and the honest answer: the route asks for the session view instead, so in
// practice this is only reached with sessions in hand (see the route handler).

import type { EmbedFeed } from '@/features/cms/feed-model'
import { buildSessionCalendar } from '@/features/comms/ics'

/** Distinct from the personal schedule's PRODID, so a client lists the two as two calendars. */
const PROD_ID = '-//Bodo//Embed Feed//EN'

export function embedFeedIcs(input: {
  feed: EmbedFeed
  /** The EVENT's timezone, as an `X-WR-TIMEZONE` display hint. Every instant is still UTC. */
  timeZone: string
  dtstamp: string
}): string {
  return buildSessionCalendar({
    prodId: PROD_ID,
    // The event's name and not the embed's: the embed's name is an internal label
    // (`EmbedSettingsPanel`), and it is the conference a subscriber expects to see listed.
    calendarName: input.feed.event,
    timeZone: input.timeZone,
    sessions: input.feed.sessions,
    dtstamp: input.dtstamp,
  })
}

/**
 * The name the downloaded file lands under, derived from the event.
 *
 * ASCII, lowercase, hyphenated, and capped: a `Content-Disposition` filename is a header value,
 * so anything outside a conservative set is dropped rather than quoted or encoded. An event whose
 * name is entirely non-ASCII therefore falls back to a generic name instead of an empty one.
 */
export function embedCalendarFilename(eventName: string): string {
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
  return `${slug === '' ? 'agenda' : slug}.ics`
}
