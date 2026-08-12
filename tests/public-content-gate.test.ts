// Which MODE the content gate is in, decided by the agenda rather than configured.
//
// tests/public-visibility.test.ts pins what each mode does to one row. This pins the
// derivation, which is the part with the risk in it, and both directions of that risk are
// silent:
//
//   - Too permissive, and a session nobody signed off is on the conference website. That is
//     the requirement `publicSessionRows` exists for.
//   - Too strict, and an event whose `contentStatus` column has never been touched loses its
//     whole public agenda and every embed with it, because cms/reads.ts goes through the
//     same DAL read. That was measured on the real base, not imagined.
//
// The rule that satisfies both: approval decides publication from the moment one session on
// the agenda IS approved. Before that, only the sessions actually in review are held back.

import { describe, expect, it } from 'vitest'

import type { ContentStatus, SubmissionStatus } from '@/constants/status'
import { publicSessionRows } from '@/features/agenda/public-agenda'

type Row = {
  id: string
  status: SubmissionStatus
  scheduleStatus: 'unscheduled' | 'scheduled' | 'published'
  calendarStatus: 'active' | 'cancelled'
  contentStatus: ContentStatus
  startsAt?: string
}

const row = (over: Partial<Row> & { id: string }): Row => ({
  status: 'accepted',
  scheduleStatus: 'published',
  calendarStatus: 'active',
  contentStatus: 'approved',
  startsAt: '2026-10-12T17:00:00.000Z',
  ...over,
})

describe('publicSessionRows', () => {
  it('publishes only what was approved, once anything has been approved', () => {
    // The requirement, as data: an approved session is public and an unapproved one is not,
    // and `not_submitted` counts as unapproved because the organizer is using approval to
    // decide. The `approved` row is what puts the gate in this mode.
    const rows = [
      row({ id: 'approved' }),
      row({ id: 'pending', contentStatus: 'pending_review' }),
      row({ id: 'sent-back', contentStatus: 'changes_requested' }),
      row({ id: 'nothing', contentStatus: 'not_submitted' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['approved'])
  })

  it('publishes everything on an agenda where approval has not started', () => {
    // The same four rows with the approval taken away. Nothing here is signed off, so
    // nothing is being measured against sign-off: only the two rows actually in review are
    // held back, and the untouched ones stay on the page.
    const rows = [
      row({ id: 'nothing-1', contentStatus: 'not_submitted' }),
      row({ id: 'pending', contentStatus: 'pending_review' }),
      row({ id: 'sent-back', contentStatus: 'changes_requested' }),
      row({ id: 'nothing-2', contentStatus: 'not_submitted' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['nothing-1', 'nothing-2'])
  })

  it('answers the question the gate exists for: approve one, send one back', () => {
    // The manual check, as data. Two sessions, one approved and one not signed off: only the
    // approved one is public, and approving the other puts it back.
    const rows = [
      row({ id: 'signed-off' }),
      row({ id: 'sent-back', contentStatus: 'changes_requested' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['signed-off'])
    expect(
      publicSessionRows(rows.map((r) => ({ ...r, contentStatus: 'approved' as const }))).map(
        (r) => r.id,
      ),
    ).toEqual(['signed-off', 'sent-back'])
  })

  it('still applies all three row rules underneath', () => {
    // The gate composes onto `publicAgendaRows` rather than replacing it, so approving the
    // content of a withdrawn or unpublished session does not put it back on the page.
    const rows = [
      row({ id: 'live' }),
      row({ id: 'unpublished', scheduleStatus: 'scheduled' }),
      row({ id: 'cancelled', calendarStatus: 'cancelled' }),
      row({ id: 'withdrawn', status: 'withdrawn' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['live'])
  })

  it('decides the mode from the public candidates, not from every submission', () => {
    // An approval on a session that is not on the agenda does not put the agenda into the
    // strict mode. This is what stops the gate emptying a page: the row that turns it on is
    // itself public, so there is always something left to read.
    const rows = [
      row({ id: 'approved-but-unpublished', scheduleStatus: 'scheduled' }),
      row({ id: 'approved-but-withdrawn', status: 'withdrawn' }),
      row({ id: 'live', contentStatus: 'not_submitted' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['live'])
  })

  it('never empties an agenda it has put into the strict mode', () => {
    // The property, checked rather than asserted in prose: whatever the mix, if the strict
    // mode is on then an approved candidate exists, and an approved candidate is public.
    const mixes: readonly (readonly ContentStatus[])[] = [
      ['approved', 'not_submitted', 'not_submitted'],
      ['approved', 'pending_review', 'changes_requested'],
      ['not_submitted', 'approved'],
      ['approved'],
    ]

    for (const mix of mixes) {
      const rows = mix.map((contentStatus, index) =>
        row({ id: `s${String(index)}`, contentStatus }),
      )
      expect(publicSessionRows(rows).length).toBeGreaterThan(0)
    }
  })

  it('keeps the start-time order it inherits', () => {
    const rows = [
      row({ id: 'late', startsAt: '2026-10-12T18:00:00.000Z' }),
      row({ id: 'early', startsAt: '2026-10-12T09:00:00.000Z' }),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['early', 'late'])
  })

  it('publishes a whole event that has never touched the content column', () => {
    // THE REGRESSION TEST, and it is the measured base rather than an invented one: an event
    // whose `contentStatus` column is entirely unset, which is what `mapSubmission` reads
    // every row of an older base as.
    //
    // The first version of this gate withheld everything that was not `approved`, which took
    // a 14-session agenda to 1 and emptied five embed views with it. All 14 must survive,
    // and the derived mode is what guarantees it: nothing here is approved, so approval is
    // not the rule yet.
    //
    // Pinned as a whole event rather than as one row, because the failure was never about a
    // single session: it was that the DEFAULT state of every session was the withheld state.
    const rows = Array.from({ length: 14 }, (_, index) =>
      row({ id: `untouched-${String(index)}`, contentStatus: 'not_submitted' }),
    )

    expect(publicSessionRows(rows)).toHaveLength(14)
  })

  it('costs an event the sessions it has not signed off, once it starts signing off', () => {
    // The other side of the same coin, and the cost of this design stated as data: an
    // organizer who approves one session on a 14-session agenda has told the gate that
    // approval is the rule, and the thirteen nobody has read come off the page. That is the
    // requirement, and it is why the mode is derived rather than assumed: it cannot happen
    // without somebody choosing `Approved` on the Content control.
    const rows = [
      row({ id: 'approved-1' }),
      ...Array.from({ length: 13 }, (_, index) =>
        row({ id: `untouched-${String(index)}`, contentStatus: 'not_submitted' }),
      ),
    ]

    expect(publicSessionRows(rows).map((r) => r.id)).toEqual(['approved-1'])
  })

  it('does not mutate the input', () => {
    const rows = [
      row({ id: 'b', startsAt: '2026-10-12T18:00:00.000Z' }),
      row({ id: 'a', startsAt: '2026-10-12T09:00:00.000Z' }),
    ]

    publicSessionRows(rows)

    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })
})
