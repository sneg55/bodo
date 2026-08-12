// The SUBMISSION STATUS donut, ref 36: a centre reading "N awaiting decision" and four
// segments that split accepted and pending by abstract versus session.
//
// The split is BUILD_SPEC 5.1b and it is NOT a lookup through the form. `reviewRequired` is
// stamped on the submission at creation from the form's `entityKind` and never re-read,
// precisely so an organizer flipping a form from Sessions to Abstracts cannot retroactively
// drag confirmed sponsors into a review queue. Reading the form here would resurrect that
// bug on this one screen: a sponsor keynote that arrived accepted would start reporting as
// a pending abstract because somebody changed a dropdown months later. So `reviewRequired`
// is the whole rule, exactly as `features/review/ratings.ts` reads it.
//
// A session-form submission is born accepted and skips review, which is why "Accepted
// sessions" is a large bucket on a healthy event and not an anomaly.
//
// Pure, tested in tests/dashboard-status-mix.test.ts.

import type { SubmissionWithParticipants } from '@/types/domain'

/** Ref 36, verbatim, under the section heading. */
export const STATUS_MIX_DESCRIPTION = 'Counts session submissions (not people), at top level only.'

/**
 * Ref 36's legend rows, in the captured order. A list of pairs rather than a keyed record so
 * the order lives with the labels and nothing indexes an object by a computed key.
 */
const SEGMENTS = [
  { id: 'accepted_abstracts', label: 'Accepted abstracts' },
  { id: 'accepted_sessions', label: 'Accepted sessions' },
  { id: 'pending_abstracts', label: 'Pending abstracts' },
  { id: 'pending_sessions', label: 'Pending sessions' },
] as const

export type StatusMixSegmentId = (typeof SEGMENTS)[number]['id']

export const STATUS_MIX_SEGMENT_IDS: readonly StatusMixSegmentId[] = SEGMENTS.map(
  (segment) => segment.id,
)

export type StatusMixSegment = {
  id: StatusMixSegmentId
  label: string
  count: number
  /** Share of the donut, 0-100 rounded. Ref 36's legend: 1 = 20% of 5. */
  percent: number
}

export type StatusMixView = {
  /** The centre number, over "awaiting decision". */
  awaiting: number
  /** The four segments' total, which is the donut's denominator. */
  total: number
  segments: readonly StatusMixSegment[]
}

type Row = Pick<SubmissionWithParticipants, 'status' | 'reviewRequired'>

/**
 * The four segments, always all four, and the centre count.
 *
 * Three things here are decisions rather than transcription:
 *
 * - **The denominator is the four segments, not every submission.** Ref 36 prints 1, 1, 1, 2
 *   as 20/20/20/40%, which only adds up over their own total of five. Declined, withdrawn,
 *   drafts and staged decisions are therefore outside the donut, which is also what makes
 *   the percentages sum to 100 rather than to some fraction of the whole pipeline.
 * - **"Awaiting decision" is the pending rows only**, so the centre agrees with the Pending
 *   tile above it and with the "N session submissions are awaiting a decision." banner. A
 *   staged accept is a decision already made and not yet sent, which the strip says
 *   separately.
 * - **A zero segment keeps its row.** Same rule as the status tiles: a bucket that vanishes
 *   at zero makes a reader think the concept does not exist rather than that it is empty.
 *
 * Ref 36's own numbers do not reconcile with the tiles beside them (its donut totals five
 * accepted-or-pending submissions while its tiles total four), so that inconsistency is not
 * reproduced: these segments partition exactly the accepted and pending rows, and
 * `accepted_abstracts + accepted_sessions` therefore equals the Accepted tile by
 * construction.
 */
export function submissionStatusMix(submissions: readonly Row[]): StatusMixView {
  const counts = new Map<StatusMixSegmentId, number>(
    STATUS_MIX_SEGMENT_IDS.map((id) => [id, 0] as const),
  )

  for (const submission of submissions) {
    const id = segmentOf(submission)
    if (id === undefined) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  return {
    awaiting: (counts.get('pending_abstracts') ?? 0) + (counts.get('pending_sessions') ?? 0),
    total,
    segments: SEGMENTS.map((segment) => {
      const count = counts.get(segment.id) ?? 0
      return {
        id: segment.id,
        label: segment.label,
        count,
        percent: total === 0 ? 0 : Math.round((count / total) * 100),
      }
    }),
  }
}

/** Which bucket a row belongs in, or `undefined` for the statuses the donut leaves out. */
function segmentOf(submission: Row): StatusMixSegmentId | undefined {
  // `reviewRequired` is the abstract/session split (5.1b), stamped at creation. A row that
  // was never meant for review is a session.
  const kind = submission.reviewRequired ? 'abstracts' : 'sessions'
  if (submission.status === 'accepted') return `accepted_${kind}`
  if (submission.status === 'pending') return `pending_${kind}`
  return undefined
}
