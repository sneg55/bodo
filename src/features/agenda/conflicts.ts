// Agenda conflict detection (BUILD_SPEC section 5.5).
//
// Two properties drive the whole shape of this file:
//
//   1. It reports, it never blocks. Sessionboard lets an organizer create an
//      overlap and then flags it, because during agenda building a temporary
//      double-booking is a normal intermediate state. So every function here is
//      pure and total: no throwing, no I/O, no clock. A malformed row is dropped
//      from consideration rather than failing the whole pass.
//   2. "Speaker" means every row in SubmissionParticipants, not the submitter.
//      A co-presenter on two accepted sessions is the case that actually bites at
//      a conference, and a submitter-only check misses it entirely.
//
// The input is deliberately NOT `Submission`. A narrow projection keeps the rules
// testable without building a full record, and keeps the agenda UI free to feed
// it from whichever shape it already has in hand.

import type { RecordId } from '@/types/domain'

export type ScheduledSession = {
  id: RecordId
  roomId?: RecordId
  /** ISO 8601 instant, as stored on Submissions.startsAt. */
  startsAt?: string
  endsAt?: string
  /** Every participant, submitter included. Order is irrelevant, duplicates are tolerated. */
  participantSpeakerIds: readonly RecordId[]
}

export type ConflictKind = 'room' | 'participant'

export type Conflict = {
  kind: ConflictKind
  /** The session that starts first. Ties break on id, so a pair is never reported twice. */
  aId: RecordId
  bId: RecordId
  reason: string
  /** Set on `room` conflicts only. */
  roomId?: RecordId
  /** Set on `participant` conflicts only: the person who is in both places. */
  speakerId?: RecordId
}

export type ConflictReport = {
  conflicts: readonly Conflict[]
  /** Keyed by submission id, listing both sides of every pair, so a card can badge itself. */
  bySession: ReadonlyMap<RecordId, readonly Conflict[]>
  /** The number on the Conflicts tab. */
  count: number
}

/** A session that is actually on the grid: room, start, and end all resolved. */
type Slot = {
  id: RecordId
  roomId: RecordId
  /** Epoch ms. */
  start: number
  end: number
  speakerIds: readonly RecordId[]
}

type SlotPair = { a: Slot; b: Slot }

const ROOM_REASON = 'Two sessions overlap in the same room.'
const PARTICIPANT_REASON = 'The same person is scheduled in two overlapping sessions.'

export function detectConflicts(sessions: readonly ScheduledSession[]): readonly Conflict[] {
  const slots = sessions
    .map(toSlot)
    .filter((slot): slot is Slot => slot !== undefined)
    .sort(byStartThenId)

  const conflicts = [
    ...conflictsInGroups(
      groupSlots(slots, (slot) => [slot.roomId]),
      (key, { a, b }) => ({
        kind: 'room' as const,
        aId: a.id,
        bId: b.id,
        reason: ROOM_REASON,
        roomId: key,
      }),
    ),
    ...conflictsInGroups(
      groupSlots(slots, (slot) => slot.speakerIds),
      (key, { a, b }) => ({
        kind: 'participant' as const,
        aId: a.id,
        bId: b.id,
        reason: PARTICIPANT_REASON,
        speakerId: key,
      }),
    ),
  ]

  return sortConflicts(conflicts, slots)
}

/**
 * Both sides of every pair get an entry, because the badge belongs on each card
 * and the caller only knows the id of the card it is rendering.
 */
export function groupConflictsBySession(
  conflicts: readonly Conflict[],
): ReadonlyMap<RecordId, readonly Conflict[]> {
  const bySession = new Map<RecordId, Conflict[]>()
  for (const conflict of conflicts) {
    for (const id of [conflict.aId, conflict.bId]) {
      const existing = bySession.get(id)
      if (existing === undefined) {
        bySession.set(id, [conflict])
      } else {
        existing.push(conflict)
      }
    }
  }
  return bySession
}

/** One call for the agenda: the list view, the per-card badges, and the tab count. */
export function buildConflictReport(sessions: readonly ScheduledSession[]): ConflictReport {
  const conflicts = detectConflicts(sessions)
  return {
    conflicts,
    bySession: groupConflictsBySession(conflicts),
    count: conflicts.length,
  }
}

/**
 * An unscheduled row cannot conflict with anything, so it is dropped rather than
 * defaulted. A window that does not advance (end at or before start) is dropped
 * for the same reason: it occupies no time, so no overlap test can be true of it,
 * and admitting it would let a reversed window invent overlaps it does not have.
 */
function toSlot(session: ScheduledSession): Slot | undefined {
  const roomId = session.roomId
  if (roomId === undefined || roomId.trim() === '') {
    return undefined
  }
  const start = parseInstant(session.startsAt)
  const end = parseInstant(session.endsAt)
  if (start === undefined || end === undefined || end <= start) {
    return undefined
  }
  return { id: session.id, roomId, start, end, speakerIds: session.participantSpeakerIds }
}

function parseInstant(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Both rules are the same overlap test over a different grouping key, so they
 * share one implementation: by room for double-booked rooms, by person (across
 * rooms) for double-booked people. A slot listing the same speaker twice must
 * not pair with itself, hence the deduplicated keys.
 */
function groupSlots(
  slots: readonly Slot[],
  keysOf: (slot: Slot) => readonly RecordId[],
): Map<RecordId, Slot[]> {
  const groups = new Map<RecordId, Slot[]>()
  for (const slot of slots) {
    for (const key of new Set(keysOf(slot))) {
      const existing = groups.get(key)
      if (existing === undefined) {
        groups.set(key, [slot])
      } else {
        existing.push(slot)
      }
    }
  }
  return groups
}

function conflictsInGroups(
  groups: Map<RecordId, Slot[]>,
  make: (key: RecordId, pair: SlotPair) => Conflict,
): Conflict[] {
  const conflicts: Conflict[] = []
  for (const [key, group] of groups) {
    for (const pair of overlappingPairs(group)) {
      conflicts.push(make(key, pair))
    }
  }
  return conflicts
}

/** `slots` must already be sorted by start, which is what makes the break sound. */
function overlappingPairs(slots: readonly Slot[]): SlotPair[] {
  const pairs: SlotPair[] = []
  for (const [index, a] of slots.entries()) {
    for (const b of slots.slice(index + 1)) {
      // b never starts before a, so `startA < endB` holds already and only
      // `startB < endA` is left to check. Strictly: a session that begins exactly
      // when the previous one ends is adjacent, not overlapping. The first b that
      // clears a's end rules out every later b too, since starts only increase.
      if (b.start >= a.end) {
        break
      }
      pairs.push({ a, b })
    }
  }
  return pairs
}

function byStartThenId(a: Slot, b: Slot): number {
  return a.start - b.start || compareIds(a.id, b.id)
}

/**
 * Stable output so the list view does not reshuffle between renders and tests can
 * assert on order: earliest affected session first, then its counterpart, then
 * kind and cause for the pair that trips both rules at once.
 */
function sortConflicts(conflicts: Conflict[], slots: readonly Slot[]): readonly Conflict[] {
  const startById = new Map(slots.map((slot) => [slot.id, slot.start]))
  const startOf = (id: RecordId): number => startById.get(id) ?? 0

  return conflicts.sort(
    (x, y) =>
      startOf(x.aId) - startOf(y.aId) ||
      compareIds(x.aId, y.aId) ||
      startOf(x.bId) - startOf(y.bId) ||
      compareIds(x.bId, y.bId) ||
      compareIds(x.kind, y.kind) ||
      compareIds(x.roomId ?? x.speakerId ?? '', y.roomId ?? y.speakerId ?? ''),
  )
}

function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}
