// The assisted scheduler.
//
// The property that matters is not "it placed something". It is that a plan this produces
// adds NO conflicts to the report `conflicts.ts` builds, so several tests below run the
// real detector over the applied plan rather than asserting on slots by hand. A scheduler
// that packs a day and quietly double-books a co-presenter is worse than no scheduler,
// because the organizer now trusts it.

import { describe, expect, it } from 'vitest'

import { planAutoSchedule } from '@/features/agenda/auto-schedule'
import { buildConflictReport } from '@/features/agenda/conflicts'
import type { AgendaData, AgendaSession } from '@/features/agenda/types'

const ZONE = 'America/Los_Angeles'

function session(overrides: Partial<AgendaSession> & { id: string }): AgendaSession {
  return {
    code: overrides.id.toUpperCase(),
    title: `Session ${overrides.id}`,
    status: 'accepted',
    source: 'form',
    sourceName: 'Call for Speakers',
    tags: [],
    scheduleStatus: 'unscheduled',
    contentStatus: 'not_submitted',
    participants: [],
    ...overrides,
  }
}

function agenda(overrides: Partial<AgendaData> = {}): AgendaData {
  return {
    event: {
      id: 'ev1',
      name: 'AI Engineer Sandbox',
      slug: 'sandbox',
      timezone: ZONE,
      startsAt: '2026-10-12T16:00:00.000Z',
      endsAt: '2026-10-12T23:00:00.000Z',
    },
    rooms: [
      { id: 'room1', name: 'Hall A' },
      { id: 'room2', name: 'Hall B' },
    ],
    sessions: [],
    speakers: [],
    ...overrides,
  }
}

/** The plan, applied, so the real conflict detector can be run over the result. */
function applied(data: AgendaData): AgendaData {
  const plan = planAutoSchedule(data)
  const byId = new Map(plan.placements.map((placement) => [placement.submissionId, placement]))
  return {
    ...data,
    sessions: data.sessions.map((item) => {
      const placement = byId.get(item.id)
      return placement === undefined
        ? item
        : {
            ...item,
            roomId: placement.roomId,
            startsAt: placement.startsAt,
            endsAt: placement.endsAt,
          }
    }),
  }
}

function conflictsIn(data: AgendaData): number {
  return buildConflictReport(
    data.sessions.map((item) => ({
      id: item.id,
      roomId: item.roomId,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      participantSpeakerIds: item.participants.map((participant) => participant.id),
    })),
  ).count
}

describe('planAutoSchedule', () => {
  it('places every tray session and reports nothing skipped', () => {
    const data = agenda({
      sessions: [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })],
    })

    const plan = planAutoSchedule(data)

    expect(plan.placements).toHaveLength(3)
    expect(plan.skipped).toEqual([])
    expect(conflictsIn(applied(data))).toBe(0)
  })

  it('leaves a session that is already scheduled exactly where it is', () => {
    const fixed = session({
      id: 'fixed',
      scheduleStatus: 'scheduled',
      roomId: 'room1',
      startsAt: '2026-10-12T16:00:00.000Z',
      endsAt: '2026-10-12T16:30:00.000Z',
    })
    const data = agenda({ sessions: [fixed, session({ id: 'new' })] })

    const plan = planAutoSchedule(data)

    expect(plan.placements.map((placement) => placement.submissionId)).toEqual(['new'])
  })

  it('does not book a room that is already busy at that time', () => {
    // One room, and 09:00 is taken, so the tray session has to land later.
    const data = agenda({
      rooms: [{ id: 'room1', name: 'Hall A' }],
      sessions: [
        session({
          id: 'fixed',
          scheduleStatus: 'scheduled',
          roomId: 'room1',
          startsAt: '2026-10-12T16:00:00.000Z',
          endsAt: '2026-10-12T16:30:00.000Z',
        }),
        session({ id: 'new' }),
      ],
    })

    const [placement] = planAutoSchedule(data).placements

    expect(placement.roomId).toBe('room1')
    expect(placement.startsAt).toBe('2026-10-12T16:30:00.000Z')
    expect(conflictsIn(applied(data))).toBe(0)
  })

  it('will not put one person in two rooms at once', () => {
    // The rule a hand-built agenda actually breaks. Both rooms are free at 09:00, so a
    // scheduler that only checked rooms would put Chen in both of them.
    const chen = { id: 'spk_chen', name: 'Chen Wei' }
    const data = agenda({
      sessions: [
        session({ id: 'a', participants: [chen] }),
        session({ id: 'b', participants: [chen] }),
      ],
    })

    const plan = planAutoSchedule(data)

    expect(plan.placements).toHaveLength(2)
    expect(plan.placements[0].startsAt).not.toBe(plan.placements[1].startsAt)
    expect(conflictsIn(applied(data))).toBe(0)
  })

  it('fills every room in a time slot before moving to the next one', () => {
    // "Fill the gaps" means pack the day front to back. Running one room to the end of the
    // day and leaving the other empty would be the other, wrong, loop order.
    const data = agenda({ sessions: [session({ id: 'a' }), session({ id: 'b' })] })

    const plan = planAutoSchedule(data)

    expect(plan.placements.map((placement) => placement.startsAt)).toEqual([
      '2026-10-12T16:00:00.000Z',
      '2026-10-12T16:00:00.000Z',
    ])
    expect(new Set(plan.placements.map((placement) => placement.roomId)).size).toBe(2)
  })

  it('keeps a session inside the working day rather than overrunning it', () => {
    // 09:00 to 17:00 in two rooms is 32 half-hour slots. The 33rd has nowhere to go, and
    // saying so beats scheduling it at 17:30 where nobody is.
    const data = agenda({
      sessions: Array.from({ length: 33 }, (_, index) =>
        session({ id: `s${String(index).padStart(2, '0')}` }),
      ),
    })

    const plan = planAutoSchedule(data)

    expect(plan.placements).toHaveLength(32)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.skipped[0].reason).toContain('no free slot')
  })

  it('places the longest sessions first, so a workshop is not squeezed out', () => {
    // Longest-first is the whole reason the sweep is ordered. Filling the one room with
    // 30 minute talks first would leave the 120 minute workshop unplaceable.
    const workshop = session({
      id: 'workshop',
      scheduleStatus: 'unscheduled',
      startsAt: '2026-10-12T16:00:00.000Z',
      endsAt: '2026-10-12T18:00:00.000Z',
    })
    const data = agenda({
      rooms: [{ id: 'room1', name: 'Hall A' }],
      sessions: [session({ id: 'talk1' }), session({ id: 'talk2' }), workshop],
    })

    const plan = planAutoSchedule(data)

    expect(plan.placements[0].submissionId).toBe('workshop')
    expect(plan.placements[0].startsAt).toBe('2026-10-12T16:00:00.000Z')
    expect(plan.skipped).toEqual([])
  })

  it('is deterministic, so pressing the button twice proposes the same thing', () => {
    const data = agenda({
      sessions: [session({ id: 'c' }), session({ id: 'a' }), session({ id: 'b' })],
    })

    expect(planAutoSchedule(data)).toEqual(planAutoSchedule(data))
  })

  it('refuses with a reason an organizer can act on when there are no rooms', () => {
    const data = agenda({ rooms: [], sessions: [session({ id: 'a' })] })

    const plan = planAutoSchedule(data)

    expect(plan.placements).toEqual([])
    expect(plan.skipped[0].reason).toBe('this event has no rooms yet')
  })

  it('refuses with a reason when the event has no dates', () => {
    const data = agenda({
      event: { id: 'ev1', name: 'Undated', slug: 'undated', timezone: ZONE },
      sessions: [session({ id: 'a' })],
    })

    const plan = planAutoSchedule(data)

    expect(plan.skipped[0].reason).toBe('this event has no dates set')
  })

  it('uses the days already in use rather than scattering across the event span', () => {
    // An organizer who hand-placed day two is telling us which days are real. Placing the
    // tray on day one because `event.startsAt` says so would ignore that.
    const data = agenda({
      sessions: [
        session({
          id: 'fixed',
          scheduleStatus: 'scheduled',
          roomId: 'room1',
          startsAt: '2026-10-14T16:00:00.000Z',
          endsAt: '2026-10-14T16:30:00.000Z',
        }),
        session({ id: 'new' }),
      ],
    })

    const [placement] = planAutoSchedule(data).placements

    expect(placement.startsAt.startsWith('2026-10-14')).toBe(true)
  })

  it('honours a custom working day', () => {
    const data = agenda({ sessions: [session({ id: 'a' })] })

    const plan = planAutoSchedule(data, { dayStartMinute: 13 * 60, slotMinutes: 15 })

    // 13:00 in America/Los_Angeles on that date is 20:00Z.
    expect(plan.placements[0].startsAt).toBe('2026-10-12T20:00:00.000Z')
  })
})
