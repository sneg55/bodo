// The organizer's bulk nudge to speakers with outstanding FILE deliverables, and the message
// it sends. CNT-08.
//
// The gap this closes: the bulk reminder existed only on the Tasks page, where it covers
// portal onboarding to-dos. The File Requests deliverables dashboard, which is where an
// organizer goes when a release form is late, offered Assign and Export and nothing that
// chases anybody. Two eval agents reported the same absence.
//
// A SECOND message rather than a second recipient list on the task reminder, because the two
// name different work. A speaker who owes a signed release and has finished every onboarding
// task is not behind on tasks at all, so folding the documents into that body would either
// mail nobody or mail the wrong list. The mechanism is shared and unchanged: both build
// `OutboxDraft` rows and both go out through `enqueueEmails`, which is the one mailing path.
//
// THE BODY IS IN CODE AND IS NOT AN EDITABLE TEMPLATE, for the reason task-reminder.ts gives
// at length: it names each recipient's own outstanding documents and each deadline, so a
// stored body would either drop the list, which is the whole content of the message, or hold a
// merge field no other template has. An organizer who wants to say something else to these
// people has the bulk composer.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. Nothing in sessionboard-refs/ captures a
// deliverables reminder, so there is no parity checklist for this copy and none was invented.
//
// Pure except that nothing here writes: the rows are built and returned, and `enqueueEmails`
// is what queues them. Tested in tests/comms-file-reminder.test.ts.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import type {
  OutstandingDeliverable,
  OutstandingFileSpeaker,
} from '@/features/files/outstanding-deliverables'
import type { OutboxDraft } from '@/services/airtable/to-fields-portal'
import type { RecordId } from '@/types/domain'

/**
 * Per SPEAKER and per DAY, and on its own prefix.
 *
 * The same rule as `taskReminderKey`: pressing the button twice in a morning means one
 * reminder, chasing again three days later means a second, and only the day distinguishes
 * them. The prefix differs from the task reminder's so that the two do not suppress each
 * other, which they would if they shared a key: a speaker who owes both a document and a task
 * is behind on two separate things and must be told about both.
 */
export function fileReminderKey(speakerId: string, nowIso: string): string {
  return `file-remind:${speakerId}:${nowIso.slice(0, 10)}`
}

/**
 * Escape the one part of this body that is not written here.
 *
 * Request titles are organizer-authored and land in an HTML email. Everything else in the
 * message is a literal in this file, so this is the whole untrusted surface, and it is the
 * same treatment `renderTemplate` gives every merge value. `marked` passes raw HTML through
 * deliberately (markdown-email.ts), so it will not do this on the way past.
 */
function escapeTitle(title: string): string {
  return title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * One outstanding document as a bullet.
 *
 * The deadline is IN the line rather than summarized above it, because that is what the
 * reminder is for: "you owe three documents" tells a speaker something they could have worked
 * out, and "Signed speaker release (Due Mar 3, 2026)" tells them what to do first. A request
 * with no deadline says so rather than rendering a bare title, so a list of five does not read
 * as though the dates failed to load. An overdue one says that too, because a date alone
 * leaves the recipient to work out which side of it today falls on.
 */
function deliverableLine(item: OutstandingDeliverable): string {
  const when = item.dueLabel ?? 'No due date'
  const flags = [item.overdue ? 'OVERDUE' : undefined, item.required ? 'required' : undefined]
    .filter((flag) => flag !== undefined)
    .join(', ')
  const suffix = flags.length === 0 ? '' : ` - ${flags}`
  return `- **${escapeTitle(item.title)}** (${when}${suffix})`
}

export function fileReminderEmail(input: {
  name: string
  eventName: string
  deliverables: readonly OutstandingDeliverable[]
  portalUrl: string
}): { readonly subject: string; readonly html: string } {
  const count =
    input.deliverables.length === 1 ? '1 file' : `${String(input.deliverables.length)} files`

  const body = [
    `Hi ${input.name},`,
    '',
    // The count is in the body as well as the subject, because a speaker who has sent most of
    // what was asked for reads a bare "you have files outstanding" as a mistake.
    `We are still waiting on ${count} for ${input.eventName}:`,
    '',
    ...input.deliverables.map(deliverableLine),
    '',
    `[Upload them in your speaker portal](${input.portalUrl})`,
    '',
    'Each one is uploaded against its own request in the portal, so you can send them as they',
    'are ready rather than waiting to have everything. If something on that list has already',
    'been sent or does not apply to you, tell us rather than leaving it open.',
  ].join('\n')

  return {
    subject: `${input.eventName}: ${count} still outstanding`,
    html: emailHtmlFromMarkdown(body),
  }
}

export type FileReminderInput = {
  readonly eventId: RecordId
  readonly eventName: string
  /** Already filtered to people who owe a document. See `outstandingDeliverableRows`. */
  readonly recipients: readonly OutstandingFileSpeaker[]
  readonly portalUrl: string
  /** One instant for the whole batch, so the send reads as one event in the log. */
  readonly now: string
}

export function fileReminderRows(input: FileReminderInput): readonly OutboxDraft[] {
  return input.recipients.map((recipient) => ({
    eventId: input.eventId,
    templateSource: 'system' as const,
    idempotencyKey: fileReminderKey(recipient.speakerId, input.now),
    // Carried so the row lands in the CRM timeline for this person as well as in the event's
    // Email history: `enqueueEmails` expires `speaker:{id}:comms` for every distinct speaker
    // among the rows it queues.
    speakerId: recipient.speakerId,
    toEmail: recipient.email,
    sendAt: input.now,
    payload: {
      ...fileReminderEmail({
        name: recipient.name,
        eventName: input.eventName,
        deliverables: recipient.deliverables,
        portalUrl: input.portalUrl,
      }),
      attachIcs: false,
    },
  }))
}
