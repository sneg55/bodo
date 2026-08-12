// The rules and the read behind a speaker's public permalink, `/speakers/<eventSlug>/<speakerSlug>`.
//
// WHY A PERMALINK AT ALL. The speaker gallery already exists, but every speaker on it is a dialog
// inside one page: there is no address a speaker can paste into a post and nothing for a social
// card to unfurl. The link travelling IS the feature, so the page's metadata is the point.
//
// VISIBILITY COMES FROM THE PUBLISHED AGENDA AND FROM NOWHERE ELSE. The candidates are the
// participants of `listPublishedAgenda`, never `listSpeakers`: that table holds everyone who
// applied, including the rejected and the still-under-review, so a page that resolved a name off
// it would confirm to anyone guessing that a named person applied and was turned down. Same rule
// as `readApiSpeakers` (@/features/api/reads) and `embedSpeakers` (@/features/cms/speakers).
//
// NO EMAIL AND NO PHONE CROSS THIS BOUNDARY. `PublicSpeaker` is a hand-written narrowing of
// `Speaker` rather than a `Speaker` with two fields blanked, because a narrowing stops compiling
// the day somebody adds a contact column and a blanking would carry it out to the internet.

import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt } from '@/features/agenda/time'
import { type SpeakerProfileLink, speakerProfileLinks } from '@/features/crm/speaker-links'
import { speakerInitials } from '@/features/speakers/initials'
import { getEventBySlug, listPublishedAgenda, listRooms } from '@/services/airtable/queries'
import type { Event, Speaker } from '@/types/domain'
import { safeRichHtml } from '@/utils/safe-html'

/** Long enough that a base36 32-bit hash always fits, short enough to stay readable in a URL. */
const SUFFIX_LENGTH = 6

/** What the name half becomes when nothing survives the fold, and the ceiling on its length. */
const UNNAMED = 'speaker'
const MAX_NAME_CHARS = 60

/** Everything the slug needs. A `Speaker` satisfies it, and so does a test fixture. */
export type SluggableSpeaker = {
  readonly id: string
  readonly firstName?: string
  readonly lastName?: string
}

/** What a public session row needs to carry. `SubmissionWithParticipants` satisfies it. */
export type PublicSessionRow = {
  readonly id: string
  readonly title: string
  readonly startsAt?: string
  readonly endsAt?: string
  readonly roomId?: string
  readonly participants: readonly { readonly speakerId: string }[]
}

/** One line of the speaker's schedule: what they are giving, when, and where. */
export type PublicSpeakerSession = {
  readonly id: string
  readonly title: string
  /** Day and clock range, both in the EVENT's timezone. Absent while the session is unscheduled. */
  readonly day?: string
  readonly time?: string
  readonly room?: string
}

/** The speaker, as the public is allowed to see them. */
export type PublicSpeaker = {
  readonly id: string
  readonly name: string
  /** For the avatar when there is no headshot. */
  readonly initials: string
  readonly tagline?: string
  readonly company?: string
  readonly headshotUrl?: string
  /** Sanitized on the way out of the read, per the rule in @/utils/safe-html. */
  readonly bioHtml?: string
  readonly links: readonly SpeakerProfileLink[]
}

export type PublicSpeakerProfile = {
  readonly event: Event
  /** The canonical slug, which is not always the one the visitor typed. */
  readonly slug: string
  readonly speaker: PublicSpeaker
  readonly sessions: readonly PublicSpeakerSession[]
}

/**
 * The URL segment for one speaker: `ada-okafor-1x8f3k`. Two speakers with one name differ in the
 * suffix, which is the whole reason there is a suffix.
 *
 * The name folds to ASCII (`José Álvarez-Núñez` becomes `jose-alvarez-nunez`) and a name in a
 * script with no ASCII form folds to nothing and falls back to `speaker`. That reads poorly and
 * still WORKS, because the suffix carries the identity. Percent-encoding the original trades a
 * readable failure for an unreadable one: the encoded form has to survive a paste into a post, a
 * mail client's rewriting, and two browsers disagreeing about NFC versus NFD.
 *
 * The suffix HASHES the record id rather than slicing it, because an Airtable id is case-sensitive
 * base62 and a slug ending in its last six characters stops resolving the moment something
 * lowercases the URL, which mail clients and chat apps do.
 */
export function speakerSlug(speaker: SluggableSpeaker): string {
  const name = `${speaker.firstName ?? ''} ${speaker.lastName ?? ''}`
  return `${slugName(name)}-${idSuffix(speaker.id)}`
}

/**
 * The speaker a URL segment names, or `undefined`. Derives every candidate's slug and compares:
 * parsing the segment apart would have to guess where the name ends, and a name contains hyphens.
 */
export function findPublicSpeaker<T extends SluggableSpeaker>(
  speakers: readonly T[],
  slug: string,
): T | undefined {
  const wanted = slug.trim().toLowerCase()
  if (wanted === '') return undefined
  return speakers.find((speaker) => speakerSlug(speaker) === wanted)
}

/** Everyone on the published schedule, once each, in the order the schedule introduces them. */
export function publicSpeakerRoster<T extends { readonly id: string }>(
  rows: readonly { readonly participants: readonly { readonly speaker: T }[] }[],
): readonly T[] {
  const byId = new Map<string, T>()
  for (const row of rows) {
    for (const participant of row.participants) {
      if (!byId.has(participant.speaker.id)) byId.set(participant.speaker.id, participant.speaker)
    }
  }
  return [...byId.values()]
}

/**
 * This speaker's sessions, in the order the read handed them over, each stamped with its day, its
 * clock range and its room.
 *
 * No second sort: `listPublishedAgenda` is already in start order, and re-sorting would put the
 * undated sessions somewhere the agenda page does not, so a visitor holding both open would see
 * one schedule in two orders. The room arrives as a LOOKUP the caller built from one `listRooms`
 * call, because resolving it per row is the fan-out BUILD_SPEC 3.1 forbids. Every instant is read
 * in the event's timezone: Workers run `Date` and `Intl` in UTC, so a bare `toLocaleString` would
 * show a 9am talk at 4pm on a page whose whole job is saying when to turn up.
 */
export function publicSpeakerSessions(
  rows: readonly PublicSessionRow[],
  speakerId: string,
  context: { timeZone: string; roomName: (id: string) => string | undefined },
): readonly PublicSpeakerSession[] {
  return rows
    .filter((row) => row.participants.some((participant) => participant.speakerId === speakerId))
    .map((row) => ({
      id: row.id,
      title: row.title,
      ...maybe('day', sessionDay(row.startsAt, context.timeZone)),
      ...maybe('time', sessionTime(row, context.timeZone)),
      ...maybe('room', row.roomId === undefined ? undefined : context.roomName(row.roomId)),
    }))
}

/**
 * The one sentence a social card gets under the title. Not built from the biography, though that
 * is the longest text on the page: it is stored as HTML, an unfurl is plain text, and a bio's
 * first 200 characters are usually a sentence that only means something with the rest of it.
 */
export function speakerMetaDescription(profile: {
  speaker: Pick<PublicSpeaker, 'name' | 'tagline' | 'company'>
  event: Pick<Event, 'name'>
  sessions: readonly unknown[]
}): string {
  const role = [profile.speaker.tagline, profile.speaker.company]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' · ')
  const count = profile.sessions.length
  const tail = count === 0 ? '' : `: ${count} ${count === 1 ? 'session' : 'sessions'}`
  const speaking = `Speaking at ${profile.event.name}${tail}.`
  return role === '' ? speaking : `${role}. ${speaking}`
}

/**
 * A stored image address turned into an absolute one, or `undefined` when it cannot be. An
 * `og:image` MUST be absolute: a scraper has no base to resolve `/files/x` against and drops a
 * relative one silently rather than reporting it. `headshotUrl` is normally absolute already (it
 * is built from `R2_PUBLIC_BASE_URL`) but it is also a plain text column an organizer can type
 * into, so it is resolved against this deployment's origin and refused off http and https.
 */
export function absoluteUrl(value: string, origin: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    const url = new URL(trimmed, origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * The whole page, or `undefined` for both "no such event" and "no such speaker". One value for the
 * two misses on purpose, because the caller answers 404 to each: telling them apart would let
 * anyone walk a real event's slug space and learn which guesses named a person who exists but is
 * not on the public schedule. The rooms are read alongside the agenda rather than after the
 * speaker resolves: one cached read wasted on the 404 path, one round trip saved on every hit.
 */
export async function readPublicSpeakerProfile(
  eventSlug: string,
  slug: string,
): Promise<PublicSpeakerProfile | undefined> {
  const event = await getEventBySlug(eventSlug)
  if (event === undefined) return undefined

  const [sessions, rooms] = await Promise.all([listPublishedAgenda(event.id), listRooms(event.id)])
  const speaker = findPublicSpeaker(publicSpeakerRoster(sessions), slug)
  if (speaker === undefined) return undefined

  const roomName = new Map(rooms.map((room) => [room.id, room.name]))
  return {
    event,
    slug: speakerSlug(speaker),
    speaker: toPublicSpeaker(speaker),
    sessions: publicSpeakerSessions(sessions, speaker.id, {
      timeZone: event.timezone,
      roomName: (id) => roomName.get(id),
    }),
  }
}

/**
 * The narrowing: everything the page may show and nothing it may not. `speakerInitials` is handed
 * the two name halves and NOT the email, unlike every other caller. Its email fallback is right on
 * an organizer's screen, where a blank circle among duplicates is unidentifiable, and wrong here:
 * it would print the first letter of a private address onto a public page.
 */
function toPublicSpeaker(speaker: Speaker): PublicSpeaker {
  const bio = safeRichHtml(speaker.bio ?? '')
  return {
    id: speaker.id,
    name: `${speaker.firstName} ${speaker.lastName}`.trim(),
    initials: speakerInitials({ firstName: speaker.firstName, lastName: speaker.lastName }),
    ...maybe('tagline', speaker.tagline),
    ...maybe('company', speaker.company),
    ...maybe('headshotUrl', speaker.headshotUrl),
    // A bio that was nothing but disallowed markup sanitizes to an empty string, which has to read
    // as absent so the page shows its empty state rather than a rendered blank.
    ...maybe('bioHtml', bio.trim() === '' ? undefined : bio),
    links: speakerProfileLinks(speaker),
  }
}

/** Omits an absent field rather than setting it `undefined`, and reads an empty string as absent. */
function maybe<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<K, never> {
  return value === undefined || value === ''
    ? ({} as Record<K, never>)
    : ({ [key]: value } as Record<K, V>)
}

/** `Wed, June 3, 2026`, or `undefined` when there is no start or the stored instant is junk. */
function sessionDay(startsAt: string | undefined, timeZone: string): string | undefined {
  if (startsAt === undefined) return undefined
  const key = dateKeyAt(startsAt, timeZone)
  if (key === undefined) return undefined
  return formatAgendaDate(key, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
}

/** `9:00 AM - 10:00 AM`, or just the start when the session has no end. */
function sessionTime(
  slot: { startsAt?: string; endsAt?: string },
  timeZone: string,
): string | undefined {
  if (slot.startsAt === undefined) return undefined
  const start = minutesAt(slot.startsAt, timeZone)
  if (start === undefined) return undefined
  const end = slot.endsAt === undefined ? undefined : minutesAt(slot.endsAt, timeZone)
  return end === undefined
    ? formatMinutes(start)
    : `${formatMinutes(start)} - ${formatMinutes(end)}`
}

/** The readable half of the slug. Empty after folding means the name contributed nothing. */
function slugName(name: string): string {
  const folded = name
    // Decomposed first, so `é` becomes `e` plus a combining accent and only the accent is dropped.
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .slice(0, MAX_NAME_CHARS)
    // After the slice, because truncating mid-word can leave a separator hanging off the end.
    .replaceAll(/^-+|-+$/gu, '')
  return folded === '' ? UNNAMED : folded
}

/**
 * FNV-1a over the record id, base36: six lowercase characters, stable for the record's lifetime.
 * Written out rather than imported because `crypto.subtle` is async, which would make every caller
 * of `speakerSlug` async for the sake of six characters.
 */
function idSuffix(id: string): string {
  let hash = 0x81_1c_9d_c5
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    // `Math.imul` keeps the multiply in 32 bits; a plain `*` loses precision past 2^53.
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0
  }
  return hash.toString(36).padStart(SUFFIX_LENGTH, '0').slice(-SUFFIX_LENGTH)
}
