// The bulk nudge to reviewers who still owe work, and the message it sends.
//
// The only reminder machinery that existed was the speaker-task cron in
// `src/features/jobs/reminders.ts`, which has no reviewer target and nothing an admin can
// trigger. This is the reviewer half, and it is admin-triggered rather than scheduled: a
// committee is chased when a chair decides the round is running late, not on a timer that
// would mail people about a deadline nobody has agreed yet.
//
// Pure except for the enqueue. The rows and the body are built here and tested; the write
// is `enqueueEmails`, which upserts on `idempotencyKey`, so a second click inside the same
// day is reported as skipped rather than sent twice.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import type { ReviewerProgressRow } from '@/features/review/reviewer-progress'
import type { OutboxDraft } from '@/services/airtable/to-fields-portal'
import type { RecordId } from '@/types/domain'

export type ReviewerReminderInput = {
  eventId: RecordId
  eventName: string
  roundId: RecordId
  roundName: string
  /** Already filtered to people with outstanding work. See `reviewersBehind`. */
  recipients: readonly ReviewerProgressRow[]
  /** The round's close date, if it has one. Named in the body when present. */
  closesAt?: string
  queueUrl: string
  /** One instant for the whole batch, so the send reads as one event in the log. */
  now: string
}

/**
 * Per REVIEWER and per DAY, not per click.
 *
 * A chair who presses the button twice in a morning means one reminder; a chair who
 * chases again three days later means a second one, and only the day distinguishes them.
 * The round is in the key too, so a committee behind on both rounds hears about each.
 *
 * This is the same shape as `draftReminder` in triggers.ts and for the same reason: what
 * makes a legitimate resend different from a duplicate has to be inside the key.
 */
export function reviewerReminderKey(roundId: string, reviewerId: string, now: string): string {
  return `review-remind:${roundId}:${reviewerId}:${now.slice(0, 10)}`
}

export function reviewerReminderEmail(input: {
  name: string
  eventName: string
  roundName: string
  outstanding: number
  assigned: number
  closesAt?: string
  queueUrl: string
}): { readonly subject: string; readonly html: string } {
  const count =
    input.outstanding === 1 ? '1 submission' : `${String(input.outstanding)} submissions`

  const body = [
    `Hi ${input.name},`,
    '',
    // The numbers are in the body rather than only in the subject, because a reviewer who
    // has done most of their queue reads "you have reviews outstanding" as a mistake.
    `You have ${count} still to review in **${input.roundName}** for ${input.eventName}, out of ${String(input.assigned)} assigned to you.`,
    ...(input.closesAt === undefined ? [] : ['', `The round closes ${input.closesAt}.`]),
    '',
    `[Open your review queue](${input.queueUrl})`,
    '',
    'If something in your queue is a conflict of interest, mark it as one there rather than',
    'leaving it unscored: a recused submission stops counting against you and the chair can',
    'reassign it.',
  ].join('\n')

  return {
    subject: `${input.roundName}: ${count} left to review`,
    html: emailHtmlFromMarkdown(body),
  }
}

export function reviewerReminderRows(input: ReviewerReminderInput): readonly OutboxDraft[] {
  return input.recipients.map((recipient) => ({
    eventId: input.eventId,
    templateSource: 'system' as const,
    idempotencyKey: reviewerReminderKey(input.roundId, recipient.reviewerId, input.now),
    toEmail: recipient.email,
    sendAt: input.now,
    payload: {
      ...reviewerReminderEmail({
        name: recipient.name,
        eventName: input.eventName,
        roundName: input.roundName,
        outstanding: recipient.outstanding,
        assigned: recipient.assigned,
        closesAt: input.closesAt,
        queueUrl: input.queueUrl,
      }),
      attachIcs: false,
    },
  }))
}
