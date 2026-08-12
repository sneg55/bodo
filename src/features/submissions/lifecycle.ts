// What a public submit lands as, decided by the form's `entityKind`.
//
// This is the one place BUILD_SPEC section 5.1b is expressed, and it is a real
// behavioural difference rather than a label. An `abstracts` form is an
// application, so it arrives pending and waits for review. A `sessions` form is a
// confirmed speaker (a sponsor, a keynote, an invited talk), so it arrives
// accepted and never enters a review queue.
//
// `reviewRequired` is stamped on the row here, at creation, and never re-read from
// the form afterwards: an organizer flipping a form from Sessions to Abstracts must
// not retroactively drag already-confirmed sponsors into a review queue.

import type { FormEntityKind, SubmissionStatus } from '@/constants/status'

export type SubmissionLifecycle = {
  status: SubmissionStatus
  reviewRequired: boolean
  /**
   * Whether the submit should materialise `SubmissionRounds` and
   * `ReviewAssignments` rows for the active plan's first round. False for a
   * session, which nobody scores, so the agenda's unscheduled tray is its first
   * stop.
   */
  createsReviewRows: boolean
}

/**
 * A switch rather than a lookup Map so `switch-exhaustiveness-check` fails the
 * build when a third intake kind is added, instead of a `Map.get` quietly
 * returning undefined and a fallback deciding a lifecycle nobody chose.
 */
export function submissionLifecycle(kind: FormEntityKind): SubmissionLifecycle {
  switch (kind) {
    case 'abstracts':
      return { status: 'pending', reviewRequired: true, createsReviewRows: true }
    case 'sessions':
      return { status: 'accepted', reviewRequired: false, createsReviewRows: false }
  }
}
