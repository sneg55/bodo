// The public agenda: the published schedule, grouped into days a visitor can read.
//
// This is the reader that makes Publish Agenda mean something. `listPublishedAgenda`
// decides WHICH rows are public (public-agenda.ts owns those two rules and nothing here
// re-filters them); this module decides what they look like once they are.
//
// The grouping is a pure function so the parts that are easy to get silently wrong are
// testable without a request: a 7pm session must belong to the evening a visitor is
// standing in rather than to tomorrow in UTC, a room or track that has since been deleted
// must not print a record id at an attendee, and a published row with no start time has
// to land somewhere visible instead of disappearing.
//
// Grouping choice: day, then start time within the day. Neither docs/parity/agenda.md nor
// docs/parity/cms-embeds.md captures a public agenda layout (the embed preview in ref 33
// shows only an empty header band), so this is our choice, not transcribed parity. The
// start order comes in with the rows and is deliberately not re-sorted here.

import { describeSessions } from '@/features/agenda/public-descriptions'
import { listForms, listPublishedAgenda, listRooms, listTracks } from '@/services/airtable/queries'
import type { Room, Track } from '@/types/domain'

import { dateKeyAt, formatAgendaDate, formatMinutes, minutesAt, zoneAbbrevAt } from './time'

/** The bucket for a published session whose start time is missing. */
export const UNDATED_DAY_KEY = 'undated'
export const UNDATED_DAY_LABEL = 'Time to be announced'

/**
 * What the grouping needs off a submission, and no more, so a test can build one by
 * hand. `SubmissionWithParticipants` satisfies it.
 */
export type PublicScheduleRow = {
  id: string
  title: string
  startsAt?: string
  endsAt?: string
  roomId?: string
  trackId?: string
  /**
   * The abstract, already lifted out of `answersJson` by whoever read the row. Optional:
   * a manually created session has no form, so it has no abstract question to answer.
   */
  description?: string
  participants: readonly {
    speaker: { id?: string; firstName: string; lastName: string }
  }[]
}

/** One session as a visitor sees it: every id already resolved to a name. */
export type PublicSession = {
  id: string
  title: string
  /** Formatted in the event's timezone. Absent when the session has no start time. */
  time?: string
  room?: string
  track?: string
  speakers: readonly string[]
  /**
   * Speaker record ids, positionally aligned with `speakers`, so a card can link a name to
   * that person without a second lookup. Empty when the reader supplied no ids.
   */
  speakerIds: readonly string[]
  /**
   * The WHOLE abstract, not truncated. Truncation is a rendering decision, each surface
   * wants a different length, and doing it here would leave the detail view unable to show
   * the rest of a text the card had already cut. The card clamps it in CSS.
   */
  description?: string
  /**
   * The raw instants, carried alongside the formatted `time`. A detail view shows the full
   * range and an add-to-calendar export needs real timestamps; neither can recover them
   * from a localised label like `10:00 AM - 10:30 AM`.
   */
  startsAt?: string
  endsAt?: string
}

export type PublicScheduleDay = {
  /** A `YYYY-MM-DD` key in the event's timezone, or `UNDATED_DAY_KEY`. */
  key: string
  label: string
  sessions: readonly PublicSession[]
}

type ScheduleLookups = {
  rooms: readonly Room[]
  tracks: readonly Track[]
}

/**
 * The whole public read for one event: published rows plus the two lookups needed to
 * turn a room id and a track id into names.
 *
 * Four DAL calls in parallel, each cached and tagged where its fetch happens
 * (`submissionsCache` subscribes to `event:{id}:agenda:published`, which is what
 * publishing expires), so a visitor arriving after a publish sees the new schedule and
 * everyone else is served from the Data Cache.
 *
 * Forms is the fourth, and it buys the abstract: the field registry keeps `description`
 * out of the columns, so it lives in `answersJson` under the form field's id and cannot
 * be read without the form. See `describeSessions`.
 */
export async function getPublicSchedule(
  eventId: string,
  timeZone: string,
): Promise<readonly PublicScheduleDay[]> {
  const [rows, rooms, tracks, forms] = await Promise.all([
    listPublishedAgenda(eventId),
    listRooms(eventId),
    listTracks(eventId),
    listForms(eventId),
  ])
  const describe = describeSessions(forms)
  return groupPublicSchedule(
    rows.map((row) => ({ ...row, description: describe(row) })),
    { rooms, tracks },
    timeZone,
  )
}

export function groupPublicSchedule(
  rows: readonly PublicScheduleRow[],
  lookups: ScheduleLookups,
  timeZone: string,
): readonly PublicScheduleDay[] {
  const roomById = new Map(lookups.rooms.map((room) => [room.id, room.name]))
  const trackById = new Map(lookups.tracks.map((track) => [track.id, track.name]))
  // Insertion-ordered, so the days come out in the order their first session does.
  const byDay = new Map<string, PublicSession[]>()

  for (const row of rows) {
    const key =
      (row.startsAt === undefined ? undefined : dateKeyAt(row.startsAt, timeZone)) ??
      UNDATED_DAY_KEY
    const sessions = byDay.get(key) ?? []
    sessions.push({
      id: row.id,
      title: row.title,
      time: slotLabel(row, timeZone),
      room: row.roomId === undefined ? undefined : roomById.get(row.roomId),
      track: row.trackId === undefined ? undefined : trackById.get(row.trackId),
      speakers: row.participants.map((participant) =>
        `${participant.speaker.firstName} ${participant.speaker.lastName}`.trim(),
      ),
      // Positional, so `speakers[i]` and `speakerIds[i]` are the same person. `flatMap`
      // would break that alignment for a participant whose speaker row carries no id.
      speakerIds: row.participants.map((participant) => participant.speaker.id ?? ''),
      description: row.description,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })
    byDay.set(key, sessions)
  }

  return [...byDay].map(([key, sessions]) => ({ key, label: dayLabel(key), sessions }))
}

/**
 * `10:00 AM - 10:30 AM`, or just the start when there is no end.
 *
 * An end time is optional on a submission row, and printing an empty range reads as a
 * rendering bug to a visitor rather than as missing data.
 *
 * Two cases print backwards if the wall-clock times are shown bare, because a local
 * time-of-day is not a total order over instants. Both are disambiguated rather than
 * hidden, each by the thing that actually distinguishes them:
 *
 *   - The range crosses midnight, so the end belongs to the next day: `11:30 PM -
 *     12:30 AM (Nov 2)`.
 *   - The range crosses a daylight-saving fall-back, so the same wall-clock hour happens
 *     twice: a 30-minute session at `2026-11-01T05:45Z` in New York rendered as
 *     `1:45 AM - 1:15 AM`, and now reads `1:45 AM EDT - 1:15 AM EST`.
 */
function slotLabel(row: PublicScheduleRow, timeZone: string): string | undefined {
  if (row.startsAt === undefined) return undefined
  const start = minutesAt(row.startsAt, timeZone)
  if (start === undefined) return undefined
  if (row.endsAt === undefined) return formatMinutes(start)

  const end = minutesAt(row.endsAt, timeZone)
  if (end === undefined) return formatMinutes(start)
  if (end > start) return `${formatMinutes(start)} - ${formatMinutes(end)}`

  const startDay = dateKeyAt(row.startsAt, timeZone)
  const endDay = dateKeyAt(row.endsAt, timeZone)
  if (startDay !== undefined && endDay !== undefined && startDay !== endDay) {
    return `${formatMinutes(start)} - ${formatMinutes(end)} (${formatAgendaDate(endDay)})`
  }

  // Same local day and the clock did not advance, so the offset moved under it. Absent
  // abbreviations (an unrecognised zone) leave the bare range, which is what it was.
  const from = zoneAbbrevAt(row.startsAt, timeZone)
  const to = zoneAbbrevAt(row.endsAt, timeZone)
  if (from === undefined || to === undefined) {
    return `${formatMinutes(start)} - ${formatMinutes(end)}`
  }
  return `${formatMinutes(start)} ${from} - ${formatMinutes(end)} ${to}`
}

function dayLabel(key: string): string {
  if (key === UNDATED_DAY_KEY) return UNDATED_DAY_LABEL
  return formatAgendaDate(key, { weekday: 'long', month: 'long', day: 'numeric' })
}
