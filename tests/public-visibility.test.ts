// The content approval gate, per row: the second thing standing between a published session
// and a visitor.
//
// `publicAgendaRows` (tests/public-agenda.test.ts) already pins the three row rules. This
// pins the fourth, which is a different KIND of rule: the other three ask whether the
// organizer meant to publish the session, and this one asks whether anybody has read what
// the speaker is going to present.
//
// It is pinned as a pure predicate rather than through the page because the failure mode is
// silent in both directions. A gate that leaks shows an unapproved session to the public
// and nothing errors; a gate that over-blocks empties the agenda and nothing errors either.
// The second is why `publicWithholding` returns a REASON and not a boolean: the admin
// agenda prints it, so a session an organizer published and cannot find is explained on the
// screen they published it from.
//
// The gate has two modes. This file pins what each mode does to one row; which mode a whole
// agenda is in is derived, and that is pinned in tests/public-content-gate.test.ts.

import { describe, expect, it } from 'vitest'

import type { ContentStatus, SubmissionStatus } from '@/constants/status'
import {
  contentApprovalRequired,
  contentNoteLabel,
  isPubliclyVisible,
  publicContentNote,
  publicWithholding,
  withholdingLabel,
} from '@/features/agenda/public-agenda'

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

const REQUIRED = { requireContentApproval: true }

describe('publicWithholding', () => {
  it('withholds nothing from a published, accepted, approved session', () => {
    expect(publicWithholding(row({ id: 'a' }))).toBeUndefined()
    expect(publicWithholding(row({ id: 'a' }), REQUIRED)).toBeUndefined()
    expect(isPubliclyVisible(row({ id: 'a' }))).toBe(true)
    expect(isPubliclyVisible(row({ id: 'a' }), REQUIRED)).toBe(true)
  })

  it('withholds a session that entered review and did not come out, in either mode', () => {
    // `changes_requested` is the case the gate exists for: an organizer has read the
    // material and sent it back, and the session was still sitting on the public page.
    // `pending_review` is the same workflow one step earlier and nobody has signed it off.
    // Neither depends on the mode: entering review is enough on its own.
    for (const contentStatus of ['pending_review', 'changes_requested'] as const) {
      expect(publicWithholding(row({ id: 'a', contentStatus }))).toBe('content_not_approved')
      expect(publicWithholding(row({ id: 'a', contentStatus }), REQUIRED)).toBe(
        'content_not_approved',
      )
    }
  })

  it('lets a never-reviewed session through until approval is what decides publication', () => {
    // The permissive mode, and the reason the withheld set is not `!== 'approved'`. On the
    // base this is judged against, 30 of 31 submissions carry no `contentStatus` at all,
    // which maps to `not_submitted` (`mapSubmission`), so an unconditional "approved or
    // nothing" took the live public agenda from 14 sessions to 1 and emptied every embed
    // with it.
    //
    // Before an organizer has approved anything, a session nobody has uploaded a deck for
    // has a title, a time and a room, and none of that is a deliverable awaiting sign-off.
    expect(publicWithholding(row({ id: 'a', contentStatus: 'not_submitted' }))).toBeUndefined()
    expect(isPubliclyVisible(row({ id: 'a', contentStatus: 'not_submitted' }))).toBe(true)

    // Once it is, the same row is not signed off, and it is held back.
    expect(publicWithholding(row({ id: 'a', contentStatus: 'not_submitted' }), REQUIRED)).toBe(
      'content_not_approved',
    )
    expect(isPubliclyVisible(row({ id: 'a', contentStatus: 'not_submitted' }), REQUIRED)).toBe(
      false,
    )
  })

  it('asks the questions in the order an organizer would', () => {
    // Publication first: an unpublished session is not being withheld, it was never offered,
    // and reporting "content not approved" against it would send the organizer to the wrong
    // control. Cancellation and the review status both outrank content for the same reason,
    // and the mode does not reorder them.
    expect(publicWithholding(row({ id: 'a', scheduleStatus: 'scheduled' }), REQUIRED)).toBe(
      'not_published',
    )
    expect(
      publicWithholding(
        row({ id: 'a', calendarStatus: 'cancelled', contentStatus: 'not_submitted' }),
        REQUIRED,
      ),
    ).toBe('cancelled')
    expect(
      publicWithholding(
        row({ id: 'a', status: 'withdrawn', contentStatus: 'not_submitted' }),
        REQUIRED,
      ),
    ).toBe('not_accepted')
  })

  it('labels every reason, so no raw underscore reaches the agenda', () => {
    for (const reason of [
      'not_published',
      'cancelled',
      'not_accepted',
      'content_not_approved',
    ] as const) {
      expect(withholdingLabel(reason)).not.toContain('_')
    }
    expect(contentNoteLabel('content_not_requested')).not.toContain('_')
  })
})

describe('contentApprovalRequired', () => {
  it('is off for an agenda nobody has approved anything on', () => {
    expect(contentApprovalRequired([])).toBe(false)
    expect(
      contentApprovalRequired([
        { contentStatus: 'not_submitted' },
        { contentStatus: 'pending_review' },
        { contentStatus: 'changes_requested' },
      ]),
    ).toBe(false)
  })

  it('is on as soon as one session is approved', () => {
    expect(
      contentApprovalRequired([{ contentStatus: 'not_submitted' }, { contentStatus: 'approved' }]),
    ).toBe(true)
  })
})

describe('publicContentNote', () => {
  it('names the session that is live with nobody having read it', () => {
    // The asymmetry that reads as a bug from outside, said on the organizer's own row.
    expect(publicContentNote(row({ id: 'a', contentStatus: 'not_submitted' }))).toBe(
      'content_not_requested',
    )
    expect(contentNoteLabel('content_not_requested')).toBe('Published, content not requested')
  })

  it('says nothing about a row that is not on the page, or one that was approved', () => {
    expect(publicContentNote(row({ id: 'a' }))).toBeUndefined()
    expect(publicContentNote(row({ id: 'a', contentStatus: 'pending_review' }))).toBeUndefined()
    expect(
      publicContentNote(row({ id: 'a', contentStatus: 'not_submitted' }), REQUIRED),
    ).toBeUndefined()
    expect(
      publicContentNote(
        row({ id: 'a', contentStatus: 'not_submitted', scheduleStatus: 'scheduled' }),
      ),
    ).toBeUndefined()
  })
})
