// The organizer's bulk nudge to speakers with outstanding tasks, and the message it sends.
// CNT-08.
//
// The gap this closes: a task-reminder body existed in the outbox and nothing organizer-facing
// could send it. The per-request Options menu offered `Request from accepted speakers`, the
// Delivery status rows carried no per-row action, and the Tasks page offered only `Assign to
// accepted speakers`. Assigning work and chasing it are different verbs and only the first
// one had a control.
//
// Admin-triggered rather than scheduled, which is `reviewer-reminder.ts`'s shape and is chosen
// for the same reason: a roster is chased when an organizer decides the deliverables are
// running late, not on a timer that would mail people about a deadline nobody has agreed yet.
// The scheduled sweep in features/jobs/reminders.ts is the other half and stays what it is,
// a CFP draft reminder keyed off a form's close date.
//
// THE BODY IS IN CODE AND IS NOT AN EDITABLE TEMPLATE, and that is a deliberate no rather
// than an omission. reminders.ts already argues the case for the draft reminder: its text
// names the deadline that is left, which is per reminder rather than per event, so there is no
// static string that could be shown in an editor without misrepresenting what goes out. This
// one is further along the same axis. It names each recipient's own outstanding tasks and
// each of their due dates, so a stored body would either drop the list, which is the entire
// content of the message, or hold a merge field for something no other template has. An
// organizer who wants to say something else to these people has the bulk composer.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. Nothing in sessionboard-refs/ captures a
// deliverables reminder, so there is no parity checklist for this copy and none was invented.
//
// Pure except that nothing here writes: the rows are built and returned, and `enqueueEmails`
// is what queues them. Tested in tests/comms-task-reminder.test.ts.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import type { OutstandingSpeaker, OutstandingTask } from '@/features/comms/outstanding-tasks'
import type { OutboxDraft } from '@/services/airtable/to-fields-portal'
import type { RecordId } from '@/types/domain'

/**
 * Per SPEAKER and per DAY, not per click.
 *
 * An organizer who presses the button twice in a morning means one reminder; one who chases
 * again three days later means a second, and only the day distinguishes them. Exactly
 * `reviewerReminderKey`, and for the same reason: what makes a legitimate resend different
 * from a duplicate has to be inside the key, and here there is no assignment timestamp that
 * could carry it, because the thing being reminded about is the ABSENCE of a completion.
 *
 * Deliberately NOT keyed on which tasks are outstanding. A speaker who finishes one of three
 * between two presses would otherwise get a second email the same morning, which is the
 * double-send the key exists to prevent.
 */
export function taskReminderKey(speakerId: string, nowIso: string): string {
  return `task-remind:${speakerId}:${nowIso.slice(0, 10)}`
}

/**
 * Escape the one part of this body that is not written here.
 *
 * Task titles are organizer-authored and land in an HTML email. Everything else in the
 * message is a literal in this file, so this is the whole untrusted surface, and it is the
 * same treatment `renderTemplate` gives every merge value it substitutes. `marked` passes raw
 * HTML through deliberately (markdown-email.ts), so it will not do this on the way past.
 */
function escapeTitle(title: string): string {
  return title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * One outstanding task as a bullet.
 *
 * The due date is IN the line rather than summarized above it, because that is what the
 * reminder is for: "you have three tasks outstanding" tells a speaker something they could
 * have worked out, and "Upload your headshot (Due Mar 3, 2026)" tells them what to do first.
 * A task with no deadline says so rather than rendering a bare title, so a list of five does
 * not read as though the dates failed to load.
 */
function taskLine(task: OutstandingTask): string {
  const when = task.dueLabel ?? 'No due date'
  return `- **${escapeTitle(task.title)}** (${when})`
}

export function taskReminderEmail(input: {
  name: string
  eventName: string
  tasks: readonly OutstandingTask[]
  portalUrl: string
}): { readonly subject: string; readonly html: string } {
  const count = input.tasks.length === 1 ? '1 task' : `${String(input.tasks.length)} tasks`

  const body = [
    `Hi ${input.name},`,
    '',
    // The count is in the body as well as the subject, because a speaker who has finished
    // most of their checklist reads a bare "you have tasks outstanding" as a mistake.
    `You have ${count} still outstanding for ${input.eventName}:`,
    '',
    ...input.tasks.map(taskLine),
    '',
    `[Open your speaker portal](${input.portalUrl})`,
    '',
    'Everything on that list is completed in the portal. If something there is already done',
    'or does not apply to you, tell us rather than leaving it open: an unfinished task keeps',
    'showing on our side.',
  ].join('\n')

  return {
    subject: `${input.eventName}: ${count} still outstanding`,
    html: emailHtmlFromMarkdown(body),
  }
}

export type TaskReminderInput = {
  readonly eventId: RecordId
  readonly eventName: string
  /** Already filtered to people who owe something. See `outstandingTaskRows`. */
  readonly recipients: readonly OutstandingSpeaker[]
  readonly portalUrl: string
  /** One instant for the whole batch, so the send reads as one event in the log. */
  readonly now: string
}

export function taskReminderRows(input: TaskReminderInput): readonly OutboxDraft[] {
  return input.recipients.map((recipient) => ({
    eventId: input.eventId,
    templateSource: 'system' as const,
    idempotencyKey: taskReminderKey(recipient.speakerId, input.now),
    // Carried so the row lands in the CRM timeline for this person as well as in the
    // event's Email history: `enqueueEmails` expires `speaker:{id}:comms` for every
    // distinct speaker among the rows it queues.
    speakerId: recipient.speakerId,
    toEmail: recipient.email,
    sendAt: input.now,
    payload: {
      ...taskReminderEmail({
        name: recipient.name,
        eventName: input.eventName,
        tasks: recipient.tasks,
        portalUrl: input.portalUrl,
      }),
      attachIcs: false,
    },
  }))
}
