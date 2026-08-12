// Assisted scheduling: propose a room and a time for every session still in the tray.
//
// The same two properties `conflicts.ts` is built around apply here, and for the same
// reasons. It PROPOSES, it never commits: the result is a plan the caller applies, so an
// organizer can be shown what would happen. And it is pure and total: no clock, no I/O,
// no throwing, and a session it cannot place is reported with a reason rather than
// dropped or forced into an overlap.
//
// It is the inverse of `conflicts.ts` and deliberately agrees with it: a plan this
// function returns must add zero conflicts to the report that file would produce. Both
// rules are honoured, not just the obvious one:
//
//   - a room holds one session at a time, and
//   - a PARTICIPANT is in one place at a time, which is the rule a hand-built agenda
//     actually breaks, because a co-presenter on two accepted sessions is invisible
//     until someone reads both cast lists.
//
// Deterministic by construction. Sessions are placed in a fixed order and each takes the
// first slot that fits, so the same input always yields the same plan: an organizer who
// presses the button twice sees the same proposal, and the tests do not have to reason
// about ordering. Nothing here calls `Math.random` or reads the clock.
//
// Several of the internals below are EXPORTED for `resolve-conflicts.ts`, which does the
// mirror-image job: this file places sessions that are nowhere, that one relocates sessions
// that are somewhere they should not be. Both need the same answers to "what is already
// booked", "is this slot free for both rules", "which days is the programme on" and "where
// does this fit first", and two copies of that search would be two chances for the placer
// and the resolver to disagree about what counts as free.

import { dateKeyAt, zonedDateTimeToIso } from '@/features/agenda/time'
import type { AgendaData, AgendaRoom, AgendaSession } from '@/features/agenda/types'

export type AutoSchedulePlacement = {
  submissionId: string
  roomId: string
  startsAt: string
  endsAt: string
}

export type AutoScheduleSkip = {
  submissionId: string
  title: string
  /** Shown to the organizer as-is, so it says what to change. */
  reason: string
}

export type AutoSchedulePlan = {
  placements: readonly AutoSchedulePlacement[]
  skipped: readonly AutoScheduleSkip[]
}

export type AutoScheduleOptions = {
  /** Minutes past local midnight the programme may start. Default 09:00. */
  dayStartMinute?: number
  /** Minutes past local midnight everything must have ENDED by. Default 17:00. */
  dayEndMinute?: number
  /** Start times are aligned to this, so the grid stays readable. Default 30. */
  slotMinutes?: number
  /** Length given to a session that has never been scheduled. Default 30. */
  defaultDurationMinutes?: number
}

export const SLOT_DEFAULTS = {
  dayStartMinute: 9 * 60,
  dayEndMinute: 17 * 60,
  slotMinutes: 30,
  defaultDurationMinutes: 30,
} as const

/** A booking already on the grid, or one this plan has just made. */
export type Booking = { roomId: string; speakerIds: readonly string[]; start: number; end: number }

/**
 * Which sessions the button acts on: everything in the tray.
 *
 * `unscheduled` is the whole test, and a session with a partial slot counts. The agenda's
 * own writer never produces one (`validatedSlot` in actions.ts insists room, start and end
 * move together), but a row edited in Airtable by hand can be, and leaving it out would
 * mean the button silently ignores exactly the rows an organizer most wants swept up.
 */
export function isUnplaced(session: AgendaSession): boolean {
  return (
    session.scheduleStatus === 'unscheduled' ||
    session.roomId === undefined ||
    session.startsAt === undefined ||
    session.endsAt === undefined
  )
}

export function bookingOf(session: AgendaSession): Booking | undefined {
  if (session.roomId === undefined || session.startsAt === undefined) return undefined
  if (session.endsAt === undefined) return undefined
  const start = Date.parse(session.startsAt)
  const end = Date.parse(session.endsAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined
  return {
    roomId: session.roomId,
    speakerIds: session.participants.map((participant) => participant.id),
    start,
    end,
  }
}

function overlaps(booking: Booking, start: number, end: number): boolean {
  return booking.start < end && start < booking.end
}

/** Free for both rules: the room is empty, and nobody in the cast is elsewhere. */
export function isFree(
  taken: readonly Booking[],
  candidate: { roomId: string; speakerIds: readonly string[]; start: number; end: number },
): boolean {
  const cast = new Set(candidate.speakerIds)
  return !taken.some(
    (booking) =>
      overlaps(booking, candidate.start, candidate.end) &&
      (booking.roomId === candidate.roomId ||
        booking.speakerIds.some((speakerId) => cast.has(speakerId))),
  )
}

/**
 * The days the programme runs, as local date keys.
 *
 * Taken from the sessions ALREADY scheduled where there are any, and from the event's own
 * dates otherwise. That ordering matters: an organizer who has hand-placed a first day is
 * telling us which days are real, and an event whose `startsAt` spans a week would
 * otherwise scatter the tray across days nobody is using.
 */
export function programmeDays(data: AgendaData): readonly string[] {
  const zone = data.event.timezone
  const used = new Set<string>()
  for (const session of data.sessions) {
    if (isUnplaced(session) || session.startsAt === undefined) continue
    const key = dateKeyAt(session.startsAt, zone)
    if (key !== undefined) used.add(key)
  }
  if (used.size > 0) return [...used].sort()

  const first = data.event.startsAt === undefined ? undefined : dateKeyAt(data.event.startsAt, zone)
  return first === undefined ? [] : [first]
}

/**
 * Sessions are swept in a fixed order so the plan is reproducible.
 *
 * Longest first, then by code. Longest-first is the standard bin-packing heuristic and it
 * matters here for a concrete reason: a 90 minute workshop placed after a day of 30 minute
 * talks has nowhere left to go, while the reverse packs cleanly. `code` breaks the tie
 * because it is stable and visible in the UI.
 */
function sweepOrder(
  sessions: readonly AgendaSession[],
  durationOf: (session: AgendaSession) => number,
): readonly AgendaSession[] {
  return [...sessions].sort((left, right) => {
    const byLength = durationOf(right) - durationOf(left)
    return byLength === 0 ? left.code.localeCompare(right.code) : byLength
  })
}

export function planAutoSchedule(
  data: AgendaData,
  options: AutoScheduleOptions = {},
): AutoSchedulePlan {
  const dayStartMinute = options.dayStartMinute ?? SLOT_DEFAULTS.dayStartMinute
  const dayEndMinute = options.dayEndMinute ?? SLOT_DEFAULTS.dayEndMinute
  const slotMinutes = options.slotMinutes ?? SLOT_DEFAULTS.slotMinutes
  const defaultDuration = options.defaultDurationMinutes ?? SLOT_DEFAULTS.defaultDurationMinutes

  const durationOf = (session: AgendaSession): number => {
    if (session.startsAt === undefined || session.endsAt === undefined) return defaultDuration
    const minutes = (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000
    return Number.isFinite(minutes) && minutes > 0 ? minutes : defaultDuration
  }

  const taken: Booking[] = data.sessions
    .filter((session) => !isUnplaced(session))
    .map(bookingOf)
    .filter((booking): booking is Booking => booking !== undefined)

  const days = programmeDays(data)
  const placements: AutoSchedulePlacement[] = []
  const skipped: AutoScheduleSkip[] = []

  for (const session of sweepOrder(data.sessions.filter(isUnplaced), durationOf)) {
    const reason = refuseReason(data, days)
    if (reason !== undefined) {
      skipped.push({ submissionId: session.id, title: session.title, reason })
      continue
    }

    const placement = firstFit({
      session,
      rooms: data.rooms,
      days,
      timeZone: data.event.timezone,
      duration: durationOf(session),
      dayStartMinute,
      dayEndMinute,
      slotMinutes,
      taken,
    })

    if (placement === undefined) {
      skipped.push({
        submissionId: session.id,
        title: session.title,
        reason: 'no free slot in any room without creating a conflict',
      })
      continue
    }

    placements.push(placement)
    taken.push({
      roomId: placement.roomId,
      speakerIds: session.participants.map((participant) => participant.id),
      start: Date.parse(placement.startsAt),
      end: Date.parse(placement.endsAt),
    })
  }

  return { placements, skipped }
}

/** The two conditions that make scheduling impossible at all, named so the UI can say so. */
function refuseReason(data: AgendaData, days: readonly string[]): string | undefined {
  if (data.rooms.length === 0) return 'this event has no rooms yet'
  if (days.length === 0) return 'this event has no dates set'
  return undefined
}

export function firstFit(input: {
  session: AgendaSession
  rooms: readonly AgendaRoom[]
  days: readonly string[]
  timeZone: string
  duration: number
  dayStartMinute: number
  dayEndMinute: number
  slotMinutes: number
  taken: readonly Booking[]
}): AutoSchedulePlacement | undefined {
  const speakerIds = input.session.participants.map((participant) => participant.id)

  // Day, then time, then room. Filling one time slot across every room before moving on
  // packs the day front to back, which is what an organizer means by "fill the gaps": the
  // other order would run one room to the end of the day and leave the rest empty.
  for (const day of input.days) {
    for (
      let minute = input.dayStartMinute;
      minute + input.duration <= input.dayEndMinute;
      minute += input.slotMinutes
    ) {
      const startsAt = zonedDateTimeToIso(day, minute, input.timeZone)
      if (startsAt === undefined) continue
      const start = Date.parse(startsAt)
      const end = start + input.duration * 60_000

      for (const room of input.rooms) {
        if (!isFree(input.taken, { roomId: room.id, speakerIds, start, end })) continue
        return {
          submissionId: input.session.id,
          roomId: room.id,
          startsAt,
          endsAt: new Date(end).toISOString(),
        }
      }
    }
  }
  return undefined
}
