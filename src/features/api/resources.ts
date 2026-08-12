// The wire shapes `/api/v1` serves, as pure projections from the domain types.
//
// Its own module, and pure, for one reason: **this is the published contract.** A field that
// silently changes name breaks somebody's integration, and that cannot be a thing a route
// handler decides in passing. Everything here is pinned by `tests/api-resources.test.ts`, so
// a rename shows up as a failing test rather than as a support question.
//
// Field names are the app's camelCase domain names, not Airtable's. That is the existing
// rule (nothing leaks past `src/services/airtable`) and it is also what keeps this shape
// stable while somebody renames a column in the base.

import type { Event, Speaker, SubmissionWithParticipants } from '@/types/domain'

export type ApiEvent = {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly timezone: string
  readonly startsAt: string | undefined
  readonly endsAt: string | undefined
  readonly location: string | undefined
  readonly websiteUrl: string | undefined
}

export type ApiSessionSpeaker = {
  readonly id: string
  readonly name: string
  readonly role: string | undefined
}

export type ApiSession = {
  readonly id: string
  /** The human-facing `SESS-<n>`, which is what an organizer will match on. */
  readonly code: string
  readonly title: string
  readonly startsAt: string | undefined
  readonly endsAt: string | undefined
  readonly room: string | undefined
  readonly track: string | undefined
  readonly format: string | undefined
  readonly level: string | undefined
  readonly language: string | undefined
  readonly speakers: readonly ApiSessionSpeaker[]
}

export type ApiSpeaker = {
  readonly id: string
  readonly name: string
  readonly firstName: string
  readonly lastName: string
  readonly tagline: string | undefined
  readonly company: string | undefined
  readonly bio: string | undefined
  readonly headshotUrl: string | undefined
}

export function apiEvent(event: Event): ApiEvent {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    location: event.location,
    websiteUrl: event.websiteUrl,
  }
}

/**
 * `room` and `track` are resolved to NAMES rather than passed through as record ids.
 *
 * A consumer of this API is putting a schedule on a website. A room id is useless to them
 * and would force a second request per session to become useful, which for a 200-session
 * conference is 200 requests to render one page.
 */
export function apiSession(
  submission: SubmissionWithParticipants,
  names: { room: (id: string) => string | undefined; track: (id: string) => string | undefined },
): ApiSession {
  return {
    id: submission.id,
    code: submission.code,
    title: submission.title,
    startsAt: submission.startsAt,
    endsAt: submission.endsAt,
    room: submission.roomId === undefined ? undefined : names.room(submission.roomId),
    track: submission.trackId === undefined ? undefined : names.track(submission.trackId),
    format: submission.format,
    level: submission.level,
    language: submission.language,
    speakers: submission.participants.map((participant) => ({
      id: participant.speaker.id,
      name: speakerName(participant.speaker),
      role: participant.role,
    })),
  }
}

/**
 * **No email, and no phone.** Sessionize's own speaker object carries neither, and this one
 * follows it: the endpoint exists so a conference site can render a lineup, and a lineup
 * needs a name, a photo and a bio. An address on this response would put every speaker's
 * contact details one leaked token away from a scraper, to serve a use case nobody asked for.
 */
export function apiSpeaker(speaker: Speaker): ApiSpeaker {
  return {
    id: speaker.id,
    name: speakerName(speaker),
    firstName: speaker.firstName,
    lastName: speaker.lastName,
    tagline: speaker.tagline,
    company: speaker.company,
    bio: speaker.bio,
    headshotUrl: speaker.headshotUrl,
  }
}

/** First and last, trimmed, so a missing half does not produce a leading or trailing space. */
export function speakerName(speaker: Pick<Speaker, 'firstName' | 'lastName'>): string {
  return `${speaker.firstName} ${speaker.lastName}`.trim()
}
