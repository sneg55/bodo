// Auto-resolve: move the sessions that are double-booked somewhere they are not.
//
// The mirror image of `auto-schedule.ts`, and it shares that file's placement search rather
// than reimplementing it, so the placer and the resolver cannot disagree about what counts
// as a free slot. It obeys the same three properties:
//
//   1. It PROPOSES. The result is a plan the caller applies, so the organizer sees the moves
//      before anything is written. This matters more here than for auto-schedule: these
//      sessions are already on the grid, so every move rewrites something an organizer put
//      there on purpose, and a speaker may already hold a calendar invite for it.
//   2. It is pure and total. No clock, no I/O, no throwing.
//   3. It is deterministic. Same agenda in, same plan out, so pressing the button twice
//      proposes the same thing and the tests need not reason about ordering.
//
// WHICH SESSION OF A CONFLICTING PAIR MOVES is the one real decision here, and the rule is:
// the one that starts LATER. `detectConflicts` walks slots sorted by start, so `aId` always
// starts at or before `bId`, which makes `bId` the mover and makes the choice fall out of
// the existing report rather than needing a second sort. It is also the right answer for an
// organizer: the earlier session is the one the day is anchored on, and a keynote at 9am
// should not be dragged around because a workshop was later booked on top of it.
//
// WHAT IT WILL NOT DO. It never unschedules a session to make a conflict go away. That
// would "resolve" the conflict by throwing the session off the agenda, which is not what
// the button offers, and it is destructive in a way a move is not. A session it cannot
// place is returned in `unresolved` with the reason, and stays exactly where it is.

import {
  type Booking,
  bookingOf,
  firstFit,
  isUnplaced,
  programmeDays,
  SLOT_DEFAULTS,
} from '@/features/agenda/auto-schedule'
import { buildConflictReport } from '@/features/agenda/conflicts'
import type { AgendaData, AgendaSession } from '@/features/agenda/types'

/** One session's relocation. Same shape as an auto-schedule placement, so it applies the same way. */
export type ConflictMove = {
  submissionId: string
  roomId: string
  startsAt: string
  endsAt: string
  /** Where it was, so the dialog can show the organizer what it is changing. */
  fromRoomId: string
  fromStartsAt: string
}

export type UnresolvedConflict = {
  submissionId: string
  title: string
  /** Shown to the organizer as-is, so it says what to change. */
  reason: string
}

export type ConflictResolutionPlan = {
  moves: readonly ConflictMove[]
  unresolved: readonly UnresolvedConflict[]
  /** Conflicts in the report this plan was built from. The number on the tab. */
  conflictCount: number
}

export type ResolveConflictsOptions = {
  dayStartMinute?: number
  dayEndMinute?: number
  slotMinutes?: number
}

/**
 * The projection `conflicts.ts` wants, from the agenda's own session shape.
 *
 * Participants are every row on the cast, not the submitter, because a co-presenter on two
 * accepted sessions is the conflict a hand-built agenda actually produces.
 */
function toScheduled(session: AgendaSession) {
  return {
    id: session.id,
    roomId: session.roomId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    participantSpeakerIds: session.participants.map((participant) => participant.id),
  }
}

function durationMinutes(session: AgendaSession): number {
  if (session.startsAt === undefined || session.endsAt === undefined) {
    return SLOT_DEFAULTS.defaultDurationMinutes
  }
  const minutes = (Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 60_000
  return Number.isFinite(minutes) && minutes > 0 ? minutes : SLOT_DEFAULTS.defaultDurationMinutes
}

/**
 * Movers are relocated longest-first, then by code.
 *
 * The same order `auto-schedule` sweeps in and for the same bin-packing reason: a 90 minute
 * workshop looking for a hole after the 30 minute talks have taken the gaps has nowhere left
 * to go, and the reverse packs cleanly. `code` breaks ties because it is stable and visible.
 */
function relocationOrder(sessions: readonly AgendaSession[]): readonly AgendaSession[] {
  return [...sessions].sort((left, right) => {
    const byLength = durationMinutes(right) - durationMinutes(left)
    return byLength === 0 ? left.code.localeCompare(right.code) : byLength
  })
}

export function planConflictResolution(
  data: AgendaData,
  options: ResolveConflictsOptions = {},
): ConflictResolutionPlan {
  const report = buildConflictReport(data.sessions.map(toScheduled))

  // Every session that is the LATER half of at least one conflict. A session can be the
  // later half of one pair and the earlier half of another; being the later half anywhere is
  // enough to make it a mover, which is what stops the plan proposing to move both sides of
  // one overlap past each other.
  const movers = new Set(report.conflicts.map((conflict) => conflict.bId))

  if (movers.size === 0) {
    return { moves: [], unresolved: [], conflictCount: report.count }
  }

  // THE MOVERS COME OUT OF `taken` FIRST, and this is what makes the search terminate
  // sensibly: a session still counted as booked would collide with itself, so nothing could
  // ever be placed back into a slot overlapping where it currently sits. What is left is
  // every session that is staying put, which is exactly the set a relocation must avoid.
  const taken: Booking[] = data.sessions
    .filter((session) => !isUnplaced(session) && !movers.has(session.id))
    .map(bookingOf)
    .filter((booking): booking is Booking => booking !== undefined)

  const days = programmeDays(data)
  const moves: ConflictMove[] = []
  const unresolved: UnresolvedConflict[] = []

  const toMove = relocationOrder(data.sessions.filter((session) => movers.has(session.id)))

  for (const session of toMove) {
    // Both are known: a session cannot be in the conflict report without a room and a slot,
    // because `toSlot` drops anything missing either. Narrowed rather than asserted so this
    // stays total.
    const fromRoomId = session.roomId
    const fromStartsAt = session.startsAt
    if (fromRoomId === undefined || fromStartsAt === undefined) continue

    if (days.length === 0) {
      unresolved.push({
        submissionId: session.id,
        title: session.title,
        reason: 'this event has no dates set',
      })
      continue
    }

    const placement = firstFit({
      session,
      rooms: data.rooms,
      days,
      timeZone: data.event.timezone,
      duration: durationMinutes(session),
      dayStartMinute: options.dayStartMinute ?? SLOT_DEFAULTS.dayStartMinute,
      dayEndMinute: options.dayEndMinute ?? SLOT_DEFAULTS.dayEndMinute,
      slotMinutes: options.slotMinutes ?? SLOT_DEFAULTS.slotMinutes,
      taken,
    })

    if (placement === undefined) {
      unresolved.push({
        submissionId: session.id,
        title: session.title,
        reason: 'no free slot in any room without creating another conflict',
      })
      // NOT added to `taken`. It stays where it is, which means it stays in conflict, and
      // the plan says so rather than quietly counting it as handled. Leaving it out of
      // `taken` also keeps a later mover from being refused a slot on account of a session
      // that is itself still broken.
      continue
    }

    moves.push({ ...placement, fromRoomId, fromStartsAt })
    taken.push({
      roomId: placement.roomId,
      speakerIds: session.participants.map((participant) => participant.id),
      start: Date.parse(placement.startsAt),
      end: Date.parse(placement.endsAt),
    })
  }

  return { moves, unresolved, conflictCount: report.count }
}
