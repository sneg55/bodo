// The notification trigger graph from BUILD_SPEC §5.3, as data.
//
// Every message bodo sends is one row here. Two properties matter more than the
// list itself:
//
//   1. Nothing sends inline. A trigger builds outbox rows and returns. An admin
//      clicking Notify on forty submissions must not be waiting on forty provider
//      calls, and a request that half-succeeded would leave twenty speakers told and
//      twenty not, with no record of which.
//   2. Every row carries a deterministic idempotency key. That key is what makes the
//      whole pipeline safe to retry: the enqueue upserts on it, so a double-clicked
//      button writes one row, and the sender passes it to the provider, so a retry
//      after a crashed-but-delivered send does not arrive twice.
//
// The keys are built here rather than at each call site precisely so they cannot
// drift. A key that varies between the enqueue and the retry is not an idempotency
// key, it is a duplicate generator.

import type { OutboxPayload } from '@/types/domain'

export type TriggerKind =
  | 'submission.confirmation'
  | 'submission.admin_new'
  | 'submission.admin_update'
  | 'submission.draft_reminder'
  | 'decision.accepted'
  | 'decision.declined'
  // The portal invitation an organizer sends from the speaker roster. Distinct from
  // `session.invite`, which is a calendar invite for one scheduled talk.
  | 'speaker.invite'
  | 'session.invite'
  | 'session.cancel'
  | 'task.assigned'
  | 'cohort.custom'

/** One outbox row, before it reaches the DAL. */
export type OutboxDraft = {
  eventId: string
  kind: TriggerKind
  toEmail: string
  idempotencyKey: string
  templateSource: 'template' | 'form_inline' | 'system'
  templateId?: string
  formId?: string
  speakerId?: string
  submissionId?: string
  taskId?: string
  sendAt: string
  payload: OutboxPayload
}

/**
 * The namespace only the bulk composer mints, and the one thing on a stored row that says
 * a person typed the message.
 *
 * It is load-bearing beyond idempotency, which is why it is named rather than inlined.
 * `EmailOutbox.templateSource` is an Airtable single-select over exactly three options
 * (`src/migrations/tables-comms.ts`), and a hand-composed send is stamped `system` there
 * because no stored template can be pointed at as the thing that was sent. That left Email
 * history unable to tell an organizer's own message apart from automated mail, which is the
 * whole question the Source column exists to answer. `isCohortKey` recovers it from the key
 * instead, with no fourth select option and no migration, and it is right about rows that
 * were sent before this existed rather than only about new ones.
 */
const COHORT_KEY_PREFIX = 'cohort:'

/**
 * Keys are namespaced by kind so two different messages about the same submission
 * cannot collide, and each carries the thing that makes a legitimate resend
 * different from a duplicate.
 *
 * The `notifiedAt` in the decision keys is the point. Re-notifying after a decision
 * was reversed and remade is a genuinely new message and must send; clicking Notify
 * twice on the same decision is not and must not. Only the timestamp distinguishes
 * them, so the timestamp is in the key.
 */
export const idempotencyKeys = {
  confirmation: (submissionId: string): string => `confirm:${submissionId}`,
  adminNew: (submissionId: string): string => `alert-new:${submissionId}`,
  adminUpdate: (submissionId: string, updatedAt: string): string =>
    `alert-update:${submissionId}:${updatedAt}`,
  // Includes the close date, so moving a deadline re-arms the reminder rather than
  // suppressing it forever.
  draftReminder: (submissionId: string, closeDate: string, hoursBefore: number): string =>
    `draft-remind:${submissionId}:${closeDate}:${String(hoursBefore)}`,
  // Per RECIPIENT, not per submission. An earlier version of the §5.3 table keyed
  // these on the submission alone, which contradicted the same section's rule that
  // every participant is told: an outbox row carries one `toEmail`, and the enqueue
  // upserts on this key, so a three-speaker session would have written one row and
  // two of the three would never have heard.
  accepted: (submissionId: string, notifiedAt: string, speakerId: string): string =>
    `accepted:${submissionId}:${notifiedAt}:${speakerId}`,
  declined: (submissionId: string, notifiedAt: string, speakerId: string): string =>
    `declined:${submissionId}:${notifiedAt}:${speakerId}`,
  // The portal invitation, keyed on the epoch it SUPERSEDES exactly as the two decision
  // keys are: the speaker's currently stored `invitedAt`, or `'first'` when they have never
  // been invited.
  //
  // What that buys is a safe RETRY, which is the failure this pipeline actually has. Rows
  // are enqueued before the stamp is written (mutations-speakers.ts says why), so a press
  // whose enqueue succeeded and whose stamp failed leaves the epoch unchanged; pressing
  // again computes the same key and `enqueueEmails` drops it, rather than mailing everyone
  // a second copy.
  //
  // It does NOT make a second deliberate invite a no-op, and it should not: once the stamp
  // has landed the epoch has moved, the key differs, and the mail goes. Re-inviting is a
  // thing an organizer does on purpose, so the button confirms rather than the key refusing.
  speakerInvite: (speakerId: string, keyEpoch: string): string =>
    `speaker-invite:${speakerId}:${keyEpoch}`,
  // Keyed on the sequence: a reschedule bumps it, so each updated invite is its own
  // message while a repeated send of the same schedule collapses.
  invite: (submissionId: string, calendarSequence: number, speakerId: string): string =>
    `invite:${submissionId}:${String(calendarSequence)}:${speakerId}`,
  cancel: (submissionId: string, calendarSequence: number, speakerId: string): string =>
    `cancel:${submissionId}:${String(calendarSequence)}:${speakerId}`,
  task: (taskAssignmentId: string): string => `task:${taskAssignmentId}`,
  cohort: (sendId: string, speakerId: string): string =>
    `${COHORT_KEY_PREFIX}${sendId}:${speakerId}`,
} as const

/** Whether this row came out of the bulk composer, i.e. somebody wrote it by hand. */
export function isCohortKey(idempotencyKey: string): boolean {
  return idempotencyKey.startsWith(COHORT_KEY_PREFIX)
}

/** Reminders fire twice before a deadline. Section 5.3. */
export const DRAFT_REMINDER_HOURS: readonly number[] = [72, 24]

/**
 * When a draft reminder should be sent, given a close date. Returns instants in the
 * past as well as the future: the caller filters, because a form whose deadline was
 * moved closer may legitimately have a reminder that is already due.
 */
export function draftReminderTimes(
  closeDate: string,
): readonly { hoursBefore: number; sendAt: string }[] {
  const close = Date.parse(closeDate)
  if (Number.isNaN(close)) return []

  return DRAFT_REMINDER_HOURS.map((hoursBefore) => ({
    hoursBefore,
    sendAt: new Date(close - hoursBefore * 60 * 60 * 1000).toISOString(),
  }))
}

/**
 * Every participant, not just the submitter. A co-speaker gets their own acceptance
 * email and their own calendar invite, which is explicit in §5.3 and is the kind of
 * thing that silently half-works if the code reaches for `submitter` out of habit.
 */
export function recipientsForDecision(
  participants: readonly { speakerId: string; email: string }[],
): readonly { speakerId: string; email: string }[] {
  const seen = new Set<string>()
  return participants.filter((participant) => {
    const key = participant.email.trim().toLowerCase()
    if (key === '' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
