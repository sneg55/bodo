// Status lifecycle rules for the admin decision path. Pure, so the expensive
// mistake is caught in a test rather than in Airtable.
//
// The rule worth stating out loud: Notify is the only thing that sends the accept
// or decline email (BUILD_SPEC section 5.3), and Notify is also the only thing
// that promotes a queue state to a final one. So a status jumping straight from
// `pending` to `accepted` is not merely an odd edit, it is a speaker who is
// accepted and will never be told. `SUBMISSION_TRANSITIONS` in @/constants/status
// already encodes that, and this module is the enforcement side of it: nothing in
// the feature writes a status without coming through here first.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { SUBMISSION_TRANSITIONS, type SubmissionStatus } from '@/constants/status'

/**
 * Map rather than record indexing. `security/detect-object-injection` is a warning
 * that fails this build, and a status arriving from a form body is exactly the
 * dynamic key it is warning about.
 */
const LEGAL_NEXT: ReadonlyMap<SubmissionStatus, readonly SubmissionStatus[]> = new Map(
  Object.entries(SUBMISSION_TRANSITIONS).map(([from, next]) => [from as SubmissionStatus, next]),
)

export function legalNextStatuses(from: SubmissionStatus): readonly SubmissionStatus[] {
  return LEGAL_NEXT.get(from) ?? []
}

/**
 * A no-op edit is allowed. The inline chip editor commits on Save whether or not
 * the value changed, and refusing that would surface a lifecycle error for an
 * action that changes nothing.
 */
export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return from === to || legalNextStatuses(from).includes(to)
}

export function assertTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
  context: Record<string, unknown> = {},
): void {
  if (canTransition(from, to)) return
  throw new AppError(
    ErrorIds.SUB_ILLEGAL_TRANSITION,
    `${from} cannot become ${to}: promote through the accept or decline queue so Notify can send the email`,
    { ...context, from, to, allowed: legalNextStatuses(from) },
  )
}

export type QueueDecision = 'accept' | 'decline'

const QUEUE_TARGET: ReadonlyMap<QueueDecision, SubmissionStatus> = new Map([
  ['accept', 'accept_queue'],
  ['decline', 'decline_queue'],
])

/** Where a bulk "move to Accept Queue" or "move to Decline Queue" lands a row. */
export function queueTarget(decision: QueueDecision): SubmissionStatus {
  // Total by construction: QueueDecision has exactly the two members above, so the
  // fallback is unreachable and exists only because Map#get is nullable.
  return QUEUE_TARGET.get(decision) ?? 'pending'
}

/**
 * What Notify commits a staged row to. `undefined` means the row is not staged, and
 * that is a skip rather than an error: an admin selecting fifteen rows and pressing
 * Notify should not be refused because two of them were already notified.
 */
const COMMIT_TARGET: ReadonlyMap<SubmissionStatus, SubmissionStatus> = new Map([
  ['accept_queue', 'accepted'],
  ['decline_queue', 'declined'],
])

export function commitTarget(from: SubmissionStatus): SubmissionStatus | undefined {
  return COMMIT_TARGET.get(from)
}

export function decisionOf(committed: SubmissionStatus): QueueDecision | undefined {
  if (committed === 'accepted') return 'accept'
  if (committed === 'declined') return 'decline'
  return undefined
}

/**
 * What a Notify press (or a Preview) would commit this row to, or `undefined` when
 * there is nothing to send. CFP-14.
 *
 * The ordinary case is `commitTarget`: a row staged in `accept_queue`/`decline_queue`
 * commits to its target. `SUBMISSION_TRANSITIONS` also allows `accept_queue ->
 * accepted` and `decline_queue -> declined` directly, though, because a mistaken
 * accept has to be walkable back without two hops, and the inline status chip editor
 * offers every legal next status without knowing which ones are "supposed" to go
 * through Notify. An organizer who picks `Accepted` straight off that chip lands a row
 * `commitTarget` no longer recognises: `accepted`'s only legal next moves are
 * `withdrawn` and `decline_queue` (SUBMISSION_TRANSITIONS), so there is no click that
 * gets it back into `accept_queue`, and a status jump that skips Notify skips the only
 * thing that ever writes the email. That speaker could not be told, permanently.
 *
 * The fix is not a new transition, it is treating "already decided" as notifiable:
 * a row already sitting on `accepted` or `declined` needs no further status move, so
 * the target IS the row's current status, and `commitStatus` just restamps
 * `notifiedAt` on it. `assertTransition` still runs against this target and allows it
 * for the ordinary reason a no-op edit is legal (`from === to`).
 *
 * A row that already carries `notifiedAt` is excluded from this second case, because
 * it was told once already and this function's whole job is deciding whether a press
 * has anything left to send. That is also what stops a decided-and-notified row from
 * being notified a second time by a later press: the guard reads the row's OWN stored
 * `notifiedAt`, not a flag `notifyQueuedAction` sets as it goes, so pressing Notify
 * again on a submission that already sent finds `notifiedAt` populated and skips it.
 */
export function notifyTarget(
  status: SubmissionStatus,
  notifiedAt: string | undefined,
): SubmissionStatus | undefined {
  const staged = commitTarget(status)
  if (staged !== undefined) return staged
  if (notifiedAt !== undefined) return undefined
  return decisionOf(status) === undefined ? undefined : status
}
