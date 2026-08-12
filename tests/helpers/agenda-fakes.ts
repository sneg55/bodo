// Fixtures for the agenda planners, in the shape `tests/helpers/team-fakes.ts` uses.
//
// Extracted when tests/agenda-resolve-conflicts.test.ts passed the 300 line limit. The
// scheduled-session builder is the one worth sharing: an `AgendaSession` carries eleven
// fields the placement rules never look at, so a test that spells them out inline is mostly
// noise, and every new required field on the domain type would otherwise have to be added in
// each test file that builds one.
//
// `conflictCountOf` is here for a sharper reason than tidiness. It runs the REAL detector
// over an agenda, which is the only assertion that catches a planner resolving one overlap
// by creating another, and both planners are supposed to be checked that way.

import { buildConflictReport } from '@/features/agenda/conflicts'
import type { AgendaData, AgendaSession } from '@/features/agenda/types'

export const ZONE = 'America/Los_Angeles'

/**
 * Defaults to `scheduled`, which is the state the conflict rules care about. Auto-schedule's
 * own tests build unscheduled ones and pass `scheduleStatus` explicitly.
 */
export function session(overrides: Partial<AgendaSession> & { id: string }): AgendaSession {
  return {
    code: overrides.id.toUpperCase(),
    title: `Session ${overrides.id}`,
    status: 'accepted',
    source: 'form',
    sourceName: 'Call for Speakers',
    tags: [],
    scheduleStatus: 'scheduled',
    contentStatus: 'not_submitted',
    participants: [],
    ...overrides,
  }
}

export function agenda(overrides: Partial<AgendaData> = {}): AgendaData {
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

/** A cast list as the agenda carries it. Only the id is read by either planner. */
export function cast(...ids: readonly string[]) {
  return ids.map((id) => ({ id, name: `Speaker ${id}`, isPrimary: false }))
}

/** The REAL detector over an agenda. The assertion a planner cannot talk its way past. */
export function conflictCountOf(data: AgendaData): number {
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
