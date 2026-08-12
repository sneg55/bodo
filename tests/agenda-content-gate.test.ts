// What the organizer's agenda says about the public page, checked against what the public
// page actually serves.
//
// The gate itself (public-agenda.ts) has two modes and derives which one an agenda is in from
// the agenda. The organizer surfaces have to derive it the SAME way: both the toolbar count
// (`AgendaSurface`) and the Schedule Status cell (`list/agenda-cells.tsx`) call
// `publicWithholding` per row, and a row cannot answer that question for a whole agenda by
// itself. Passing no mode meant they answered in the permissive mode always, so on an event
// that HAS started approving content they reported nothing withheld while `publicSessionRows`
// withheld it: the row read `Published` and a visitor could not see the session.
//
// So the property under test is agreement, not a hardcoded expectation: for the same rows,
// what the surfaces flag must be exactly what the public read drops. `visibilityOf` is the
// mapping both surfaces use, and it is imported rather than restated so a change to it fails
// here rather than drifting.

import { describe, expect, it } from 'vitest'

import { visibilityOf } from '@/features/agenda/list/agenda-cells'
import {
  contentApprovalRequired,
  contentNoteLabel,
  publicAgendaRows,
  publicContentNote,
  publicSessionRows,
  publicWithholding,
} from '@/features/agenda/public-agenda'
import type { AgendaSession } from '@/features/agenda/types'

function session(id: string, overrides: Partial<AgendaSession> = {}): AgendaSession {
  return {
    id,
    code: `SESS-${id}`,
    title: `Session ${id}`,
    status: 'accepted',
    source: 'manual',
    sourceName: 'Manual',
    tags: [],
    scheduleStatus: 'published',
    contentStatus: 'not_submitted',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-12T17:00:00.000Z',
    participants: [],
    ...overrides,
  }
}

/** The mode both organizer surfaces derive, in one line, exactly as they derive it. */
function modeOf(sessions: readonly AgendaSession[]): boolean {
  return contentApprovalRequired(publicAgendaRows(sessions.map(visibilityOf)))
}

/** What the toolbar counts and what the row badge shows: withheld by the content gate. */
function withheldIds(sessions: readonly AgendaSession[]): readonly string[] {
  const requireContentApproval = modeOf(sessions)
  return sessions
    .filter(
      (row) =>
        publicWithholding(visibilityOf(row), { requireContentApproval }) === 'content_not_approved',
    )
    .map((row) => row.id)
}

/** What a visitor actually gets, through the one read every public surface goes through. */
function publicIds(sessions: readonly AgendaSession[]): readonly string[] {
  return publicSessionRows(sessions.map((row) => ({ ...visibilityOf(row), id: row.id }))).map(
    (row) => row.id,
  )
}

describe('an agenda that has approved nothing', () => {
  const sessions = [
    session('a'),
    session('b', { contentStatus: 'pending_review' }),
    session('c', { contentStatus: 'changes_requested' }),
  ]

  it('is in the permissive mode, so an untouched session stays on the page', () => {
    expect(modeOf(sessions)).toBe(false)
    expect(publicIds(sessions)).toEqual(['a'])
  })

  it('flags exactly the sessions the public read drops', () => {
    expect(withheldIds(sessions)).toEqual(['b', 'c'])
  })

  it('notes the live session nobody has read, in the copy the badge renders', () => {
    const note = publicContentNote(visibilityOf(session('a')), { requireContentApproval: false })
    expect(note).toBe('content_not_requested')
    expect(contentNoteLabel('content_not_requested')).toBe('Published, content not requested')
  })
})

describe('an agenda where one session has been approved', () => {
  const sessions = [
    session('a'),
    session('b', { contentStatus: 'approved' }),
    session('c', { contentStatus: 'pending_review' }),
  ]

  it('is in the strict mode, so an unsigned-off session comes off the page', () => {
    expect(modeOf(sessions)).toBe(true)
    expect(publicIds(sessions)).toEqual(['b'])
  })

  it('flags the unsigned-off session, which is what the surfaces used to miss', () => {
    // The regression this file exists for: with no mode passed, `a` answered under the
    // permissive set and the organizer was told nothing was being withheld.
    expect(withheldIds(sessions)).toEqual(['a', 'c'])
    expect(publicWithholding(visibilityOf(session('a')), { requireContentApproval: true })).toBe(
      'content_not_approved',
    )
  })

  it('offers no "content not requested" note on a row it is withholding', () => {
    expect(publicContentNote(visibilityOf(session('a')), { requireContentApproval: true })).toBe(
      undefined,
    )
  })
})

describe('the two sides agree on every row, whatever the mode', () => {
  const shapes = [
    session('unpublished', { scheduleStatus: 'scheduled' }),
    session('unscheduled', { scheduleStatus: 'unscheduled' }),
    session('withdrawn', { status: 'withdrawn' }),
    session('untouched'),
    session('pending', { contentStatus: 'pending_review' }),
    session('sent-back', { contentStatus: 'changes_requested' }),
  ]

  for (const approved of [false, true]) {
    it(`holds with approval ${approved ? 'in use' : 'unused'} on the agenda`, () => {
      const sessions = approved
        ? [...shapes, session('signed-off', { contentStatus: 'approved' })]
        : shapes
      const visible = new Set(publicIds(sessions))
      const flagged = new Set(withheldIds(sessions))
      // Everything the surfaces flag is off the page, and nothing on the page is flagged.
      for (const id of flagged) expect(visible.has(id)).toBe(false)
      for (const id of visible) expect(flagged.has(id)).toBe(false)
      // And a published, accepted row is either on the page or flagged: never neither, which
      // is the shape of the defect (published, invisible, and nothing said so).
      const publishable = ['untouched', 'pending', 'sent-back']
      for (const id of publishable) expect(visible.has(id) || flagged.has(id)).toBe(true)
    })
  }
})
