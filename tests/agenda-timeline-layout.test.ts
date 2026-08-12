// Timeline packing: where a card sits, and how wide it is.
//
// The property under test is the one the Day view was failing: two sessions that overlap
// in one room must both be readable. Positioning alone gave them the same grid cell, so
// the second card covered the first down to its speaker line and the pair the Conflicts
// tab flags was the pair the grid hid. Every test here asserts on columns, because
// "column count > 1 and distinct column indexes" is what "neither card is hidden" reduces
// to once the grid does the drawing.

import { describe, expect, it } from 'vitest'

import {
  type TimelineLane,
  timelineLayout,
  timelinePosition,
} from '@/features/agenda/timeline/timeline-model'
import type { AgendaSession } from '@/features/agenda/types'

const ZONE = 'America/Los_Angeles'
const DATE = '2026-10-12'

const LANES: readonly TimelineLane[] = [
  { id: 'room:main', label: 'Main Stage', roomId: 'main', dateKey: DATE },
  { id: 'room:side', label: 'Side Room', roomId: 'side', dateKey: DATE },
]

/** Local wall-clock minutes on the fixed date, as an instant. October is PDT (UTC-7). */
function at(hour: number, minute = 0): string {
  return `${DATE}T${String(hour + 7).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
}

function session(
  id: string,
  roomId: string | undefined,
  startsAt: string | undefined,
  endsAt: string | undefined,
): AgendaSession {
  return {
    id,
    code: id.toUpperCase(),
    title: `Session ${id}`,
    status: 'accepted',
    source: 'form',
    sourceName: 'Call for Speakers',
    tags: [],
    scheduleStatus: roomId === undefined ? 'unscheduled' : 'scheduled',
    contentStatus: 'not_submitted',
    participants: [],
    roomId,
    startsAt,
    endsAt,
  }
}

describe('timelineLayout', () => {
  it('gives a session with no neighbour the whole lane', () => {
    const alone = session('a', 'main', at(9), at(10))
    const layout = timelineLayout([alone], LANES, ZONE)

    expect(layout.get('a')).toEqual({
      ...timelinePosition(alone, LANES, ZONE),
      column: 0,
      columns: 1,
    })
  })

  it('splits the lane between two sessions that overlap in the same room', () => {
    const layout = timelineLayout(
      [session('a', 'main', at(9), at(10)), session('b', 'main', at(9, 30), at(10, 30))],
      LANES,
      ZONE,
    )

    expect(layout.get('a')).toMatchObject({ column: 0, columns: 2 })
    expect(layout.get('b')).toMatchObject({ column: 1, columns: 2 })
  })

  it('keeps both cards at their real rows while narrowing them', () => {
    const layout = timelineLayout(
      [session('a', 'main', at(9), at(10)), session('b', 'main', at(9), at(10))],
      LANES,
      ZONE,
    )

    // Same slot exactly, which is the case that produced one fully covered card.
    expect(layout.get('a')?.rowStart).toBe(layout.get('b')?.rowStart)
    expect(layout.get('a')?.rowSpan).toBe(layout.get('b')?.rowSpan)
    expect(layout.get('a')?.column).not.toBe(layout.get('b')?.column)
  })

  it('leaves sessions in different rooms at full width', () => {
    const layout = timelineLayout(
      [session('a', 'main', at(9), at(10)), session('b', 'side', at(9), at(10))],
      LANES,
      ZONE,
    )

    expect(layout.get('a')).toMatchObject({ laneIndex: 0, column: 0, columns: 1 })
    expect(layout.get('b')).toMatchObject({ laneIndex: 1, column: 0, columns: 1 })
  })

  it('treats a session that starts when another ends as adjacent, not overlapping', () => {
    const layout = timelineLayout(
      [session('a', 'main', at(9), at(10)), session('b', 'main', at(10), at(11))],
      LANES,
      ZONE,
    )

    expect(layout.get('a')).toMatchObject({ column: 0, columns: 1 })
    expect(layout.get('b')).toMatchObject({ column: 0, columns: 1 })
  })

  it('reuses a freed column inside one cluster', () => {
    // `a` runs 9 to 11 alongside `b` 9 to 10 and `c` 10 to 11: three sessions, two columns,
    // because `c` can take the column `b` vacated. A cluster is sized once, so all three
    // are two columns wide rather than `c` snapping back to full width mid-overlap.
    const layout = timelineLayout(
      [
        session('a', 'main', at(9), at(11)),
        session('b', 'main', at(9), at(10)),
        session('c', 'main', at(10), at(11)),
      ],
      LANES,
      ZONE,
    )

    expect(layout.get('a')).toMatchObject({ column: 0, columns: 2 })
    expect(layout.get('b')).toMatchObject({ column: 1, columns: 2 })
    expect(layout.get('c')).toMatchObject({ column: 1, columns: 2 })
  })

  it('needs three columns for three sessions in one slot', () => {
    const layout = timelineLayout(
      [
        session('a', 'main', at(9), at(10)),
        session('b', 'main', at(9), at(10)),
        session('c', 'main', at(9), at(10)),
      ],
      LANES,
      ZONE,
    )

    expect([layout.get('a')?.column, layout.get('b')?.column, layout.get('c')?.column]).toEqual([
      0, 1, 2,
    ])
    expect(layout.get('c')?.columns).toBe(3)
  })

  it('drops sessions that are not on the grid', () => {
    const layout = timelineLayout(
      [
        session('tray', undefined, undefined, undefined),
        session('offgrid', 'main', at(20), at(21)),
        session('elsewhere', 'other', at(9), at(10)),
      ],
      LANES,
      ZONE,
    )

    expect(layout.size).toBe(0)
  })

  it('is stable whatever order the sessions arrive in', () => {
    const a = session('a', 'main', at(9), at(10))
    const b = session('b', 'main', at(9), at(10))
    const forwards = timelineLayout([a, b], LANES, ZONE)
    const backwards = timelineLayout([b, a], LANES, ZONE)

    expect(forwards.get('a')).toEqual(backwards.get('a'))
    expect(forwards.get('b')).toEqual(backwards.get('b'))
  })
})
