// The SUBMISSION STATUS donut, ref 36.
//
// The load-bearing case is the abstract/session split, which comes from `reviewRequired`
// and not from the form's current `entityKind` (BUILD_SPEC 5.1b). A session-form submission
// is born accepted and skips review, and a form flipped from Sessions to Abstracts months
// later must not turn those confirmed sponsors into pending abstracts on this screen.

import { describe, expect, it } from 'vitest'

import type { SubmissionStatus } from '@/constants/status'
import { submissionStatusMix } from '@/features/dashboard/status-mix'

const row = (status: SubmissionStatus, reviewRequired: boolean) => ({ status, reviewRequired })
const abstract = (status: SubmissionStatus) => row(status, true)
/** A sessions-form submit, or a manual entry filed as accepted. 5.1b: never reviewed. */
const session = (status: SubmissionStatus) => row(status, false)

describe('submissionStatusMix', () => {
  it('splits accepted and pending by abstract versus session, in ref 36 order', () => {
    const view = submissionStatusMix([
      abstract('accepted'),
      session('accepted'),
      abstract('pending'),
      session('pending'),
      session('pending'),
    ])

    expect(view.segments.map((segment) => [segment.label, segment.count, segment.percent])).toEqual(
      [
        ['Accepted abstracts', 1, 20],
        ['Accepted sessions', 1, 20],
        ['Pending abstracts', 1, 20],
        ['Pending sessions', 2, 40],
      ],
    )
  })

  it('puts "N awaiting decision" in the centre, counting pending only', () => {
    const view = submissionStatusMix([
      abstract('pending'),
      session('pending'),
      session('pending'),
      abstract('accepted'),
      // A staged decision has been made and not yet sent, which the "Also check" strip says
      // separately. Counting it here would contradict the Pending tile and the banner.
      abstract('accept_queue'),
      abstract('decline_queue'),
    ])

    expect(view.awaiting).toBe(3)
  })

  it('does not let a form flipped to Abstracts reclassify a confirmed session', () => {
    // The reason the split reads `reviewRequired` off the row instead of the form: the flag
    // is stamped at creation and never re-read (5.1b), so a sponsor keynote stays a session
    // whatever the form says now.
    const view = submissionStatusMix([session('accepted')])
    const bySegment = new Map(view.segments.map((segment) => [segment.id, segment.count]))

    expect(bySegment.get('accepted_sessions')).toBe(1)
    expect(bySegment.get('accepted_abstracts')).toBe(0)
  })

  it('leaves the statuses the donut does not show out of the denominator', () => {
    const view = submissionStatusMix([
      abstract('accepted'),
      abstract('pending'),
      abstract('declined'),
      abstract('withdrawn'),
      abstract('draft'),
    ])

    // Ref 36's percentages only add up over the four segments' own total, so declined,
    // withdrawn and drafts are outside the ring rather than shrinking every slice.
    expect(view.total).toBe(2)
    expect(view.segments.map((segment) => segment.percent)).toEqual([50, 0, 50, 0])
  })

  it('agrees with the Accepted tile by construction', () => {
    // The two accepted segments partition exactly the accepted rows. Ref 36's own donut does
    // not reconcile with its tiles (five accepted-or-pending against four submissions), and
    // that inconsistency is deliberately not reproduced.
    const rows = [
      abstract('accepted'),
      session('accepted'),
      session('accepted'),
      abstract('pending'),
      abstract('declined'),
    ]
    const view = submissionStatusMix(rows)
    const accepted = view.segments
      .filter((segment) => segment.id.startsWith('accepted_'))
      .reduce((sum, segment) => sum + segment.count, 0)

    expect(accepted).toBe(rows.filter((entry) => entry.status === 'accepted').length)
  })

  it('keeps all four rows and no NaN on an event with nothing in review', () => {
    const view = submissionStatusMix([])

    expect(view.segments).toHaveLength(4)
    expect(view.segments.every((segment) => segment.percent === 0)).toBe(true)
    expect(view.awaiting).toBe(0)
    expect(view.total).toBe(0)
  })
})
