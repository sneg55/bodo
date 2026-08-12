// Conflict detection is the rule set behind BUILD_SPEC section 5.5's acceptance
// criterion ("double-booking a room or a speaker flags visibly in all views"),
// and every one of its edge cases is painful to reproduce by dragging cards in
// the agenda UI. So it is tested directly, with literal ISO timestamps: nothing
// here reads the clock, which is what makes the boundary cases below meaningful.

import { describe, expect, it } from 'vitest'

import {
  buildConflictReport,
  detectConflicts,
  groupConflictsBySession,
  type ScheduledSession,
} from '@/features/agenda/conflicts'

const ROOM_A = 'rec-room-a'
const ROOM_B = 'rec-room-b'
const ALICE = 'rec-speaker-alice'
const BOB = 'rec-speaker-bob'
const CARLA = 'rec-speaker-carla'

/** Defaults keep each test's literal fields to the ones it is actually about. */
function session(over: Partial<ScheduledSession> & { id: string }): ScheduledSession {
  return {
    roomId: ROOM_A,
    startsAt: '2026-09-01T10:00:00.000Z',
    endsAt: '2026-09-01T11:00:00.000Z',
    participantSpeakerIds: [ALICE],
    ...over,
  }
}

describe('detectConflicts', () => {
  it('finds nothing in an empty agenda', () => {
    expect(detectConflicts([])).toEqual([])
  })

  it('finds nothing when sessions in one room do not overlap', () => {
    const conflicts = detectConflicts([
      session({ id: 's1' }),
      session({
        id: 's2',
        startsAt: '2026-09-01T13:00:00.000Z',
        endsAt: '2026-09-01T14:00:00.000Z',
      }),
    ])

    expect(conflicts).toEqual([])
  })

  it('flags two overlapping sessions in the same room', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', participantSpeakerIds: [ALICE] }),
      session({
        id: 's2',
        startsAt: '2026-09-01T10:30:00.000Z',
        endsAt: '2026-09-01T11:30:00.000Z',
        participantSpeakerIds: [BOB],
      }),
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'room', aId: 's1', bId: 's2', roomId: ROOM_A })
    expect(conflicts[0]?.speakerId).toBeUndefined()
  })

  it('flags a session fully contained inside another', () => {
    const conflicts = detectConflicts([
      session({
        id: 'outer',
        endsAt: '2026-09-01T14:00:00.000Z',
        participantSpeakerIds: [ALICE],
      }),
      session({
        id: 'inner',
        startsAt: '2026-09-01T11:00:00.000Z',
        endsAt: '2026-09-01T12:00:00.000Z',
        participantSpeakerIds: [BOB],
      }),
    ])

    expect(conflicts.map((c) => c.kind)).toEqual(['room'])
  })

  it('flags the same speaker booked in two rooms at once', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', roomId: ROOM_A }),
      session({ id: 's2', roomId: ROOM_B }),
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      kind: 'participant',
      aId: 's1',
      bId: 's2',
      speakerId: ALICE,
    })
    expect(conflicts[0]?.roomId).toBeUndefined()
  })

  it('flags a co-presenter, not just the submitter, across rooms', () => {
    // The submitters differ, so nothing about the owning speaker overlaps. Only
    // the second participant on each row does, which is the case a
    // submitter-only check misses (BUILD_SPEC section 5.5).
    const conflicts = detectConflicts([
      session({ id: 's1', roomId: ROOM_A, participantSpeakerIds: [ALICE, CARLA] }),
      session({ id: 's2', roomId: ROOM_B, participantSpeakerIds: [BOB, CARLA] }),
    ])

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'participant', speakerId: CARLA })
  })

  it('reports one conflict per shared person when two people are double-booked', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', roomId: ROOM_A, participantSpeakerIds: [ALICE, CARLA] }),
      session({ id: 's2', roomId: ROOM_B, participantSpeakerIds: [CARLA, ALICE] }),
    ])

    expect(conflicts.map((c) => c.speakerId)).toEqual([ALICE, CARLA])
  })

  it('does not flag adjacent sessions where one ends exactly when the next starts', () => {
    // Same room and the same speaker, back to back. The comparison is strict on
    // both sides for this reason.
    const conflicts = detectConflicts([
      session({ id: 's1', endsAt: '2026-09-01T11:00:00.000Z' }),
      session({
        id: 's2',
        startsAt: '2026-09-01T11:00:00.000Z',
        endsAt: '2026-09-01T12:00:00.000Z',
      }),
    ])

    expect(conflicts).toEqual([])
  })

  it('ignores rows that are not fully scheduled', () => {
    const conflicts = detectConflicts([
      session({ id: 'no-room', roomId: undefined }),
      session({ id: 'no-start', startsAt: undefined }),
      session({ id: 'no-end', endsAt: undefined }),
      session({ id: 'blank-room', roomId: '' }),
      session({ id: 'unparseable', startsAt: 'sometime tuesday' }),
    ])

    expect(conflicts).toEqual([])
  })

  it('does not flag identical times in different rooms with no shared people', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', roomId: ROOM_A, participantSpeakerIds: [ALICE] }),
      session({ id: 's2', roomId: ROOM_B, participantSpeakerIds: [BOB] }),
    ])

    expect(conflicts).toEqual([])
  })

  it('reports a pair once, not once per direction', () => {
    const conflicts = detectConflicts([
      session({
        id: 'later',
        startsAt: '2026-09-01T10:30:00.000Z',
        endsAt: '2026-09-01T11:30:00.000Z',
        participantSpeakerIds: [BOB],
      }),
      session({ id: 'earlier', participantSpeakerIds: [ALICE] }),
    ])

    expect(conflicts).toHaveLength(1)
    // Input order was reversed; the earlier session is still the a side.
    expect(conflicts[0]).toMatchObject({ aId: 'earlier', bId: 'later' })
  })

  it('reports both reasons when one pair shares a room and a person', () => {
    const conflicts = detectConflicts([
      session({ id: 's1' }),
      session({ id: 's2', startsAt: '2026-09-01T10:30:00.000Z' }),
    ])

    expect(conflicts.map((c) => c.kind)).toEqual(['participant', 'room'])
    expect(new Set(conflicts.map((c) => `${c.aId}/${c.bId}`))).toEqual(new Set(['s1/s2']))
  })

  it('finds every pair when three sessions share one slot', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', participantSpeakerIds: [ALICE] }),
      session({ id: 's2', participantSpeakerIds: [BOB] }),
      session({ id: 's3', participantSpeakerIds: [CARLA] }),
    ])

    expect(conflicts.map((c) => `${c.aId}/${c.bId}`)).toEqual(['s1/s2', 's1/s3', 's2/s3'])
  })

  it('orders output by start time then id, whatever the input order', () => {
    const late = session({
      id: 'zz-late',
      startsAt: '2026-09-01T15:00:00.000Z',
      endsAt: '2026-09-01T16:00:00.000Z',
      participantSpeakerIds: [BOB],
    })
    const lateOverlap = session({
      id: 'aa-late-overlap',
      startsAt: '2026-09-01T15:30:00.000Z',
      endsAt: '2026-09-01T16:30:00.000Z',
      participantSpeakerIds: [CARLA],
    })
    const early = session({ id: 'zz-early', participantSpeakerIds: [ALICE] })
    const earlyOverlap = session({
      id: 'aa-early-overlap',
      startsAt: '2026-09-01T10:30:00.000Z',
      participantSpeakerIds: [BOB],
    })

    const expected = ['zz-early/aa-early-overlap', 'zz-late/aa-late-overlap']
    const shuffled = [lateOverlap, early, late, earlyOverlap]

    expect(detectConflicts(shuffled).map((c) => `${c.aId}/${c.bId}`)).toEqual(expected)
    expect(detectConflicts([...shuffled].reverse()).map((c) => `${c.aId}/${c.bId}`)).toEqual(
      expected,
    )
  })
})

describe('groupConflictsBySession', () => {
  it('keys a conflict under both sides so either card can badge it', () => {
    const conflicts = detectConflicts([
      session({ id: 's1', participantSpeakerIds: [ALICE] }),
      session({
        id: 's2',
        startsAt: '2026-09-01T10:30:00.000Z',
        participantSpeakerIds: [BOB],
      }),
      session({
        id: 's3',
        startsAt: '2026-09-01T20:00:00.000Z',
        endsAt: '2026-09-01T21:00:00.000Z',
        participantSpeakerIds: [CARLA],
      }),
    ])

    const bySession = groupConflictsBySession(conflicts)

    expect(bySession.get('s1')).toHaveLength(1)
    expect(bySession.get('s2')).toHaveLength(1)
    expect(bySession.has('s3')).toBe(false)
  })
})

describe('buildConflictReport', () => {
  it('carries the count the Conflicts tab renders', () => {
    const report = buildConflictReport([
      session({ id: 's1', roomId: ROOM_A }),
      session({ id: 's2', roomId: ROOM_B }),
      session({ id: 's3', roomId: ROOM_B, startsAt: '2026-09-01T10:15:00.000Z' }),
    ])

    expect(report.count).toBe(report.conflicts.length)
    expect(report.count).toBeGreaterThan(0)
    expect(report.bySession.get('s1')?.length).toBeGreaterThan(0)
  })

  it('is empty and total for an agenda with nothing scheduled', () => {
    const report = buildConflictReport([session({ id: 's1', roomId: undefined })])

    expect(report).toEqual({ conflicts: [], bySession: new Map(), count: 0 })
  })
})
