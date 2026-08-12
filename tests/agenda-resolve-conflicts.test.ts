// Auto-resolve: relocating the sessions that are double-booked.
//
// The property that matters is not "it moved something". It is that applying the plan
// leaves the real `conflicts.ts` report EMPTY, so most tests below run the actual detector
// over the applied result rather than asserting on slots by hand. A resolver that shuffles
// sessions and leaves a co-presenter double-booked is worse than none, because the organizer
// now believes the tab is clean.
//
// The other property under test is honesty: a session it cannot place must come back in
// `unresolved`, still in conflict, rather than being counted as handled or thrown off the
// agenda to make the number go down.

import { describe, expect, it } from 'vitest'

import { planConflictResolution } from '@/features/agenda/resolve-conflicts'
import type { AgendaData } from '@/features/agenda/types'

import { agenda, cast, conflictCountOf, session } from './helpers/agenda-fakes'

/** The plan, applied, so the real conflict detector can be run over the result. */
function applied(data: AgendaData): AgendaData {
  const plan = planConflictResolution(data)
  const byId = new Map(plan.moves.map((move) => [move.submissionId, move]))
  return {
    ...data,
    sessions: data.sessions.map((item) => {
      const move = byId.get(item.id)
      return move === undefined
        ? item
        : { ...item, roomId: move.roomId, startsAt: move.startsAt, endsAt: move.endsAt }
    }),
  }
}

/** Two sessions in one room at the same time: the plainest room conflict. */
const ROOM_CLASH = agenda({
  sessions: [
    session({
      id: 'a',
      roomId: 'room1',
      startsAt: '2026-10-12T17:00:00.000Z',
      endsAt: '2026-10-12T17:30:00.000Z',
    }),
    session({
      id: 'b',
      roomId: 'room1',
      startsAt: '2026-10-12T17:00:00.000Z',
      endsAt: '2026-10-12T17:30:00.000Z',
    }),
  ],
})

describe('planConflictResolution, when there is nothing to do', () => {
  it('proposes no moves on an agenda with no conflicts', () => {
    const clean = agenda({
      sessions: [
        session({
          id: 'a',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
        }),
        session({
          id: 'b',
          roomId: 'room2',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
        }),
      ],
    })

    expect(planConflictResolution(clean)).toEqual({ moves: [], unresolved: [], conflictCount: 0 })
  })

  it('ignores the tray, which is auto-schedule s job and not this one', () => {
    // An unscheduled session cannot conflict with anything, so a resolver that swept it up
    // would be silently doing the other button's work.
    const withTray = agenda({
      sessions: [session({ id: 'a', scheduleStatus: 'unscheduled' })],
    })

    expect(planConflictResolution(withTray).moves).toEqual([])
  })
})

describe('planConflictResolution, room conflicts', () => {
  it('clears the report it was built from', () => {
    expect(conflictCountOf(ROOM_CLASH)).toBe(1)
    expect(conflictCountOf(applied(ROOM_CLASH))).toBe(0)
  })

  it('moves exactly one of the pair, not both', () => {
    expect(planConflictResolution(ROOM_CLASH).moves).toHaveLength(1)
  })

  it('moves the LATER session and leaves the earlier one anchored', () => {
    const staggered = agenda({
      sessions: [
        session({
          id: 'early',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T18:00:00.000Z',
        }),
        session({
          id: 'late',
          roomId: 'room1',
          startsAt: '2026-10-12T17:30:00.000Z',
          endsAt: '2026-10-12T18:30:00.000Z',
        }),
      ],
    })

    const { moves } = planConflictResolution(staggered)

    expect(moves.map((move) => move.submissionId)).toEqual(['late'])
  })

  it('reports where the session came from, so the dialog can show the change', () => {
    const [move] = planConflictResolution(ROOM_CLASH).moves

    expect(move.fromRoomId).toBe('room1')
    expect(move.fromStartsAt).toBe('2026-10-12T17:00:00.000Z')
  })

  it('preserves the session s duration', () => {
    const [move] = planConflictResolution(ROOM_CLASH).moves

    expect(Date.parse(move.endsAt) - Date.parse(move.startsAt)).toBe(30 * 60_000)
  })
})

describe('planConflictResolution, participant conflicts', () => {
  it('separates a co-presenter booked in two rooms at once', () => {
    // The case a hand-built agenda actually produces: two different rooms, so nothing looks
    // wrong until someone reads both cast lists.
    const shared = agenda({
      sessions: [
        session({
          id: 'a',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk1'),
        }),
        session({
          id: 'b',
          roomId: 'room2',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk1'),
        }),
      ],
    })

    expect(conflictCountOf(shared)).toBe(1)
    expect(conflictCountOf(applied(shared))).toBe(0)
  })

  it('does not park a mover on top of a third session', () => {
    // The failure mode worth pinning: resolving one overlap by creating another. The
    // detector over the applied plan is the only assertion that catches it.
    const crowded = agenda({
      sessions: [
        session({
          id: 'a',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk1'),
        }),
        session({
          id: 'b',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk2'),
        }),
        session({
          id: 'c',
          roomId: 'room2',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk3'),
        }),
      ],
    })

    expect(conflictCountOf(applied(crowded))).toBe(0)
  })
})

describe('planConflictResolution, what it refuses to do', () => {
  it('reports a session it cannot place instead of counting it resolved', () => {
    // One room, and a day already full from the first slot to the last, so the mover has
    // nowhere legal to go. The honest answer is to say so and leave it where it is.
    const packed = agenda({
      rooms: [{ id: 'room1', name: 'Hall A' }],
      sessions: [
        session({
          id: 'wall',
          roomId: 'room1',
          startsAt: '2026-10-12T16:00:00.000Z',
          endsAt: '2026-10-13T00:00:00.000Z',
        }),
        session({
          id: 'victim',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
        }),
      ],
    })

    const plan = planConflictResolution(packed)

    expect(plan.moves).toEqual([])
    expect(plan.unresolved.map((entry) => entry.submissionId)).toEqual(['victim'])
    expect(plan.unresolved[0].reason).toContain('no free slot')
  })

  it('never unschedules a session to make a conflict disappear', () => {
    // Every proposal is a MOVE: a room and a real window. Nothing in the plan can strip a
    // session off the grid, which would clear the tab by discarding the session.
    const plan = planConflictResolution(ROOM_CLASH)

    for (const move of plan.moves) {
      expect(move.roomId).not.toBe('')
      expect(Number.isNaN(Date.parse(move.startsAt))).toBe(false)
      expect(Date.parse(move.endsAt)).toBeGreaterThan(Date.parse(move.startsAt))
    }
  })

  it('carries the conflict count it planned against, so the UI cannot invent one', () => {
    expect(planConflictResolution(ROOM_CLASH).conflictCount).toBe(1)
  })

  it('does not let a session block itself out of the slot it is already in', () => {
    // The mover is dropped from `taken` before the search, and this is what that buys. Here
    // the fix is a ROOM change at the same time: room2 is free at 10:00 local and everything
    // earlier is full. A mover left in `taken` would still be holding its own 10:00 booking,
    // and because that booking carries its own cast it would fail the participant test
    // against itself, pushing the session to 10:30 for no reason.
    //
    // Both outcomes are conflict-free, so the detector cannot catch this: it is a quality
    // property, and it needs asserting on the slot.
    const onlySidewaysFits = agenda({
      sessions: [
        session({
          id: 'filler1',
          roomId: 'room1',
          startsAt: '2026-10-12T16:00:00.000Z',
          endsAt: '2026-10-12T17:00:00.000Z',
        }),
        session({
          id: 'filler2',
          roomId: 'room2',
          startsAt: '2026-10-12T16:00:00.000Z',
          endsAt: '2026-10-12T17:00:00.000Z',
        }),
        session({
          id: 'anchor',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
        }),
        session({
          id: 'mover',
          roomId: 'room1',
          startsAt: '2026-10-12T17:00:00.000Z',
          endsAt: '2026-10-12T17:30:00.000Z',
          participants: cast('spk1'),
        }),
      ],
    })

    const [move] = planConflictResolution(onlySidewaysFits).moves

    expect(move.submissionId).toBe('mover')
    expect(move.roomId).toBe('room2')
    expect(move.startsAt).toBe('2026-10-12T17:00:00.000Z')
  })
})

describe('planConflictResolution, determinism', () => {
  it('proposes the same plan twice for the same agenda', () => {
    // An organizer who opens the dialog, closes it and opens it again must not be shown a
    // different proposal, and the tests must not have to reason about ordering.
    expect(planConflictResolution(ROOM_CLASH)).toEqual(planConflictResolution(ROOM_CLASH))
  })
})
