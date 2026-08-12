// Re-labelling the grouped schedule per `Date/Time Format`, and flattening it for the Session List.
//
// Split out of ./projection so that file stays inside the 300-line budget. Everything here is a
// pure transform of what `groupPublicSchedule` produced, and none of it decides what is public: the
// visibility rule and the organizer's filters have both already run by the time these are called.
//
// The row type is written structurally rather than imported from ./projection, so the dependency
// runs one way and there is no cycle to unpick.
//
// TWO FIELDS ARE ADDED BACK HERE THAT THE PUBLIC SCHEDULE DROPS, and both are added once for every
// widget rather than per view:
//
//   - `format`. `PublicSession` carries no Format at all, so no public surface could show one. It
//     is read off the SUBMISSION row the grouping was built from, and only labelled for display
//     (@/features/cms/choice-label). Nothing here invents a value: a row with no Format still has
//     none, and the badge is simply absent.
//   - `people`. `PublicSession.speakers` is an array of bare display names, which is all the
//     agenda page ever needed. A conference programme names a speaker's job title and company
//     beside them, so the participant's `tagline` and `company` are carried through as well. The
//     bare `speakers` array is left untouched, because search and the .ics still read it.

import type { PublicScheduleDay, PublicSession } from '@/features/agenda/public-schedule'
import { embedChoiceLabel } from '@/features/cms/choice-label'
import {
  type EmbedSlot,
  embedDayLabel,
  embedStamp,
  embedTimeLabel,
} from '@/features/cms/date-format'
import type { EmbedDateFormat } from '@/types/cms'

/** One speaker as a card names them: `Ada Okafor · Principal Engineer · Latticework Systems`. */
export type EmbedSessionPerson = {
  id: string
  name: string
  /** The job title. Absent when the speaker record carries none. */
  tagline?: string
  company?: string
}

/** A public session with the two fields the widgets need and `PublicSession` does not carry. */
export type EmbedSession = PublicSession & {
  /** Already labelled for display. Absent when the submission has no Format. */
  format?: string
  people: readonly EmbedSessionPerson[]
}

/** A day of them. Assignable to `PublicScheduleDay`, since `EmbedSession` extends its session. */
export type EmbedDay = { key: string; label: string; sessions: readonly EmbedSession[] }

/**
 * A session outside a day group, so the flat view can still print its date.
 *
 * Both `dayLabel` and `stamp` are carried, because the Session card's `time` field is deselectable
 * and its `date` field is not: with time on, the row prints the stamp; with time off, the day alone.
 * Composing that in the view would mean the view knowing the date format.
 */
export type EmbedFlatSession = EmbedSession & { dayLabel: string; stamp: string }

/** What the re-labelling reads off a submission row. `EmbedSourceRow` satisfies it. */
export type EmbedDetailRow = EmbedSlot & {
  id: string
  format?: string
  participants: readonly {
    speaker: { id: string; firstName: string; lastName: string; tagline?: string; company?: string }
  }[]
}

/** The date and room a speaker's session sublist prints beside a title. */
export type EmbedSessionSlot = { when?: string; room?: string }

type SessionExtras = { format?: string; people: readonly EmbedSessionPerson[] }

/**
 * Every day label and every clock time, re-formatted per `Date/Time Format`, plus Format and the
 * speaker details the public schedule does not carry.
 *
 * `groupPublicSchedule` has already formatted both labels, one fixed way, and it belongs to the
 * public agenda page: changing it there would restyle `/agenda/<slug>` for every event to satisfy a
 * per-embed setting. So the labels are replaced here, from the SAME rows the grouping saw, and
 * @/features/cms/date-format does every timezone conversion.
 */
export function relabelEmbedDays(
  days: readonly PublicScheduleDay[],
  rows: readonly EmbedDetailRow[],
  timeZone: string,
  format: EmbedDateFormat,
): readonly EmbedDay[] {
  const slots = embedSlotsById(rows)
  const extras = embedExtrasById(rows)
  return days.map((day) => ({
    key: day.key,
    label: embedDayLabel(day.key, format),
    sessions: day.sessions.map((session) => ({
      ...session,
      time: embedTimeLabel(slots.get(session.id) ?? {}, timeZone, format),
      ...(extras.get(session.id) ?? { people: [] }),
    })),
  }))
}

/** The raw instants, by session id, so the re-labelling can format them again. */
function embedSlotsById(rows: readonly EmbedDetailRow[]): ReadonlyMap<string, EmbedSlot> {
  return new Map(rows.map((row) => [row.id, { startsAt: row.startsAt, endsAt: row.endsAt }]))
}

/** Format and the named speakers, by session id. */
function embedExtrasById(rows: readonly EmbedDetailRow[]): ReadonlyMap<string, SessionExtras> {
  return new Map(
    rows.map((row) => [
      row.id,
      {
        // Spread rather than assigned, so a row with no Format has no `format` key at all and a
        // `'format' in session` check cannot be fooled by an explicit undefined.
        ...(row.format === undefined || row.format === ''
          ? {}
          : { format: embedChoiceLabel(row.format) }),
        people: row.participants.map((participant) => toPerson(participant.speaker)),
      },
    ]),
  )
}

function toPerson(speaker: EmbedDetailRow['participants'][number]['speaker']): EmbedSessionPerson {
  return {
    id: speaker.id,
    name: `${speaker.firstName} ${speaker.lastName}`.trim(),
    ...(speaker.tagline === undefined || speaker.tagline === ''
      ? {}
      : { tagline: speaker.tagline }),
    ...(speaker.company === undefined || speaker.company === ''
      ? {}
      : { company: speaker.company }),
  }
}

/** The flat Session List: no day headers, so every row carries its own date. */
export function flattenEmbedDays(
  days: readonly EmbedDay[],
  format: EmbedDateFormat,
): readonly EmbedFlatSession[] {
  return days.flatMap((day) =>
    day.sessions.map((session) => ({
      ...session,
      dayLabel: day.label,
      stamp: embedStamp(day.label, session.time, format),
    })),
  )
}

/**
 * The date and room for every session, by id, for a speaker's session sublist.
 *
 * Taken off the FLATTENED list rather than recomputed, so the line under a speaker's name in the
 * gallery and the line on the session card are provably the same string: a detail claiming a
 * different time from the card it was opened next to is the defect this exists to prevent.
 */
export function embedSessionSlots(
  sessions: readonly EmbedFlatSession[],
): ReadonlyMap<string, EmbedSessionSlot> {
  return new Map(
    sessions.map((session) => [
      session.id,
      {
        // Always the stamp, never the bare clock time: a sublist entry under a speaker's name
        // sits outside any day heading, so a line reading `10:00 AM` says nothing about which
        // of three conference days it is. With no start time the stamp is the day label alone,
        // which for the undated bucket reads `Time to be announced`.
        when: session.stamp,
        ...(session.room === undefined ? {} : { room: session.room }),
      },
    ]),
  )
}
