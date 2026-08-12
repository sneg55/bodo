'use server'

// The bulk email composer's three actions: load starters, preview, send. SPK-13, CRM-11.
//
// All three authorize `admin` on the event themselves. A layout is not a security boundary
// (.claude/rules/bodo-conventions.md) and it matters more here than almost anywhere else in
// this admin: these actions put mail in front of every person on a roster, and a Server Action
// is reachable by POST with no page ever rendering.
//
// The ids from the browser are a FILTER over the authorized event's roster, never a recipient
// list. `resolveBulkRecipients` is where that happens and its header carries the argument.
//
// PREVIEW AND SEND SHARE ONE BUILDER, and that is the whole design of this file. The preview
// returns payloads that `bulkEmailRows` produced, so what an organizer reads in the drawer is
// literally the record that would be queued: same merge context, same escaping, same subject
// rendering. A preview assembled separately is a preview that can be right while the mail is
// wrong, which is worse than having no preview at all.

import { requireEventRole } from '@/features/auth/wiring'
import {
  bulkEmailRows,
  bulkSendId,
  type MergeFieldProblem,
  mergeFieldProblems,
} from '@/features/comms/bulk-compose'
import { assertSendable, eventContext, loadBulkComposeContext } from '@/features/comms/bulk-context'
import { greetingName } from '@/features/comms/bulk-recipients'
import { type BulkEmailStarter, bulkEmailStarters } from '@/features/comms/bulk-starters'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { enqueueEmails } from '@/services/airtable/mutations-outbox'
import { listEmailTemplates } from '@/services/airtable/reads-comms'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

/** The templates the composer offers as a starting point. */
export async function loadBulkStartersAction(input: {
  eventId: RecordId
}): Promise<ActionResult<{ starters: readonly BulkEmailStarter[] }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    return actionOk({ starters: bulkEmailStarters(await listEmailTemplates(input.eventId)) })
  } catch (error) {
    return actionFailure(error)
  }
}

export type BulkPreviewMessage = {
  readonly toEmail: string
  readonly name: string
  readonly subject: string
  readonly html: string
}

export type BulkPreviewResult = {
  /** How many messages the send would queue. */
  readonly recipients: number
  readonly skippedNoEmail: number
  readonly skippedDuplicate: number
  /**
   * Selected and not on this event, which is only ever non-zero on the cross-event CRM path.
   *
   * Reported here as well as by `resolveCrmRecipientsAction`, so an organizer who changes the
   * event after previewing sees the new exclusion in the preview rather than only in the
   * scope line they have scrolled past.
   */
  readonly notOnEvent: number
  /** Merge fields that would fail, and for how many of these people. Empty is the good case. */
  readonly problems: readonly MergeFieldProblem[]
  /** The first few messages, rendered exactly as they would be sent. */
  readonly messages: readonly BulkPreviewMessage[]
}

/**
 * How many recipients the drawer renders.
 *
 * Three rather than all of them, because the preview exists to answer "did my merge fields
 * resolve" and the fourth copy of the same body answers nothing. Rendering forty would also
 * put forty full HTML bodies in one action response for a control the organizer scrolls past.
 */
const PREVIEW_LIMIT = 3

/**
 * Render the draft against the real recipients, without queueing anything.
 *
 * Two failure modes are surfaced here rather than at send, and both are the reason this
 * action exists. A merge field the context cannot supply is reported per field with a count
 * (`mergeFieldProblems`), so "not everybody has a company on file" reads as a sentence to
 * reword rather than as a stack trace. And `bulkEmailRows` itself throws
 * `MAIL_MERGE_FIELD_UNKNOWN` on the first message it cannot render, which `actionFailure`
 * turns into that error's own message.
 */
export async function previewBulkEmailAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
  subject: string
  bodyHtml: string
}): Promise<ActionResult<BulkPreviewResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const { event, resolution } = await loadBulkComposeContext(input.eventId, input.speakerIds)
    assertSendable({ subject: input.subject, bodyHtml: input.bodyHtml, resolution })

    const shared = {
      event: eventContext(event),
      portalUrl: `${appUrl()}/portal`,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
    }

    const problems = mergeFieldProblems({ ...shared, recipients: resolution.recipients })
    // Rendered only when nothing would throw. Building the rows first would raise on the very
    // problem the report above is trying to explain, and the organizer would get the raw error
    // instead of the list of fields to fix.
    //
    // One recipient per call rather than one call over the slice, so a preview line is paired
    // with the person it was rendered for by construction instead of by a shared index.
    const now = new Date().toISOString()
    const messages =
      problems.length > 0
        ? []
        : resolution.recipients.slice(0, PREVIEW_LIMIT).flatMap((recipient) =>
            bulkEmailRows({
              ...shared,
              eventId: input.eventId,
              recipients: [recipient],
              sendAt: now,
              sendId: 'preview',
            }).map((row) => ({
              toEmail: row.toEmail,
              name: greetingName(recipient),
              subject: row.payload.subject,
              html: row.payload.html,
            })),
          )

    return actionOk({
      recipients: resolution.recipients.length,
      skippedNoEmail: resolution.skippedNoEmail,
      skippedDuplicate: resolution.skippedDuplicate,
      notOnEvent: resolution.unknownIds,
      problems,
      messages,
    })
  } catch (error) {
    return actionFailure(error)
  }
}

export type BulkSendResult = {
  readonly queued: number
  /** Rows an earlier press of the same message today already queued. */
  readonly skipped: number
  readonly skippedNoEmail: number
  readonly skippedDuplicate: number
  /** Selected and not on the event this was sent under. See `BulkPreviewResult`. */
  readonly notOnEvent: number
}

/**
 * Queue one message per recipient.
 *
 * Queued, not sent, like every other trigger: `enqueueEmails` upserts on `idempotencyKey` and
 * `features/comms/drain.ts` remains the only thing that talks to the provider, so an organizer
 * mailing eighty people waits on one batched Airtable write rather than eighty provider calls.
 * The rows land in `EmailOutbox`, which is what puts a per-recipient row with the resolved
 * subject into Email history, exactly as INVITE TO PORTAL already does.
 *
 * The key is per message per day (`bulkSendId`), so a double press queues nothing the second
 * time and the returned `skipped` says so.
 */
export async function sendBulkEmailAction(input: {
  eventId: RecordId
  speakerIds: readonly RecordId[]
  subject: string
  bodyHtml: string
}): Promise<ActionResult<BulkSendResult>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const { event, resolution } = await loadBulkComposeContext(input.eventId, input.speakerIds)
    assertSendable({ subject: input.subject, bodyHtml: input.bodyHtml, resolution })

    const now = new Date().toISOString()
    const rows = bulkEmailRows({
      eventId: input.eventId,
      event: eventContext(event),
      recipients: resolution.recipients,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      portalUrl: `${appUrl()}/portal`,
      sendAt: now,
      sendId: bulkSendId({ subject: input.subject, bodyHtml: input.bodyHtml, nowIso: now }),
    })

    const { queued, skipped } = await enqueueEmails(rows, 'action')

    return actionOk({
      queued,
      skipped,
      skippedNoEmail: resolution.skippedNoEmail,
      skippedDuplicate: resolution.skippedDuplicate,
      notOnEvent: resolution.unknownIds,
    })
  } catch (error) {
    return actionFailure(error)
  }
}
