// Who a decision mails. Split out of decision-outbox.ts because it grew past the
// file-size limit, not because the rule stands alone: `decisionOutboxRows` still owns
// rendering and CFP-14's header there explains why a preview and a send must never
// disagree about what the mail looks like. This is the other half of that guarantee,
// for who the mail goes TO.

import type { QueueDecision } from '@/features/submissions/transitions'
import type { RecordId } from '@/types/domain'

/**
 * Which participants a decision mails, filtered but not yet formatted into a
 * `DecisionRecipient`. CFP-14's second half.
 *
 * Shared so the send (`decisions.ts`) and the read (`decision-preview.ts`) filter by
 * the same rule and can never show one thing and mail another, which is the exact
 * property `decision-outbox.ts` already claims for the render half. They did not
 * share this half: `decisions.ts` filtered a decline's audience by `isPrimary`, and
 * `decision-preview.ts` filtered it by `submitterId`. Those are genuinely different
 * people whenever the primary presenter is not the account that filed the CFP, which
 * `submit-cast.ts` documents at length is a real and intended case (an assistant
 * submitting on a speaker's behalf, a co-presenter flagged primary). When they
 * disagreed, Preview rendered the correct, submitter-only decline, the organizer
 * pressed Notify believing that was what would send, and the actual send's `isPrimary`
 * filter matched nobody: `decisionOutboxRows` returned zero rows, `enqueueOutbox`
 * wrote zero rows, and the batch still reported success, because writing nothing is
 * not a failure `notifyQueuedAction` can see. That is a silent rejection notification
 * that never dispatches, with a toast that reads as if it had.
 *
 * `submitterId`, not `isPrimary`, is the one that matches BUILD_SPEC 5.3's own word
 * for it: a decline "names only the submitter", and the submitter is `Submissions.
 * submitter`, the address the Account step proved. `isPrimary` answers who presents,
 * which is a different question this recipient list was never supposed to be asking.
 */
export function decisionAudience<P extends { readonly speakerId: RecordId }>(
  participants: readonly P[],
  decision: QueueDecision,
  submitterId: RecordId,
): readonly P[] {
  if (decision === 'accept') return participants
  return participants.filter((participant) => participant.speakerId === submitterId)
}
