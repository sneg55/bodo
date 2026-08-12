'use server'

// What Notify is about to send, before it sends it. CFP-14.
//
// The dispatch confirmation and the Notified stamp were real and good; what was missing was
// any way to READ the message first. An organizer pressing Notify on forty accepted talks
// was committing an irreversible send of a body they had never seen, and the only way to
// find out what went out was to check a mailbox afterwards.
//
// It renders through `decisionOutboxRows`, the same function the send uses, rather than
// re-rendering the template beside it. A preview built from a second code path is a preview
// that can disagree with the mail, which is worse than no preview: it would be believed.
//
// Nothing is written. No outbox row, no status change, no `notifiedAt`, so pressing preview
// twice costs two Airtable reads and changes nothing.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { decisionAudience } from '@/features/submissions/decision-audience'
import { decisionOutboxRows } from '@/features/submissions/decision-outbox'
import { decisionOf, notifyTarget } from '@/features/submissions/transitions'
import { getEvent, getSubmission } from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { RecordId } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type DecisionPreview = {
  /** Who this exact message would go to. */
  readonly toEmail: string
  readonly subject: string
  readonly html: string
  /** How many people the press would mail in total, this recipient included. */
  readonly recipientCount: number
  /** Whether the body is the organizer's template or the built-in one. */
  readonly source: 'template' | 'system' | 'form_inline'
}

/**
 * Render the first recipient's copy of the decision email for one staged submission.
 *
 * The FIRST recipient rather than all of them, because an accept mails every participant and
 * the bodies differ only in the greeting: showing four near-identical previews buries the
 * thing being checked. `recipientCount` carries the fact that there are others, so the
 * organizer knows the press is wider than what they are reading.
 */
export async function previewDecisionEmailAction(input: {
  eventId: RecordId
  submissionId: RecordId
}): Promise<ActionResult<DecisionPreview>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Every refusal below is an `AppError`, and that is load-bearing rather than tidy.
    // `actionFailure` RE-THROWS anything that is not one (action-result.ts), so a plain
    // `Error` here left the action as an unhandled throw: pressing Preview email on a row
    // that is not staged replaced the whole Abstracts page with "This page couldn't load."
    // The refusal the dialog is built to show never reached it.
    const submission = await getSubmission(input.submissionId)
    if (submission.eventId !== input.eventId) {
      // The same cause as the inline status editor's own miss, so the same id: one per
      // cause, not per throw site (errorIds.ts).
      return actionFailure(
        new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that submission is not on this event', {
          submissionId: input.submissionId,
          eventId: input.eventId,
        }),
      )
    }

    // The same function Notify uses to decide what a press would commit this row to, so a
    // row this preview refuses is a row Notify would skip, and a row Notify would still
    // send for (CFP-14's re-entry case: already `accepted`/`declined`, never notified) is
    // one this preview renders too.
    const committed = notifyTarget(submission.status, submission.notifiedAt)
    const decision = committed === undefined ? undefined : decisionOf(committed)
    if (decision === undefined) {
      return actionFailure(
        new AppError(
          ErrorIds.SUB_NOT_STAGED,
          'that submission is not staged for a decision, so nothing would be sent',
          { submissionId: submission.id, status: submission.status },
        ),
      )
    }

    const event = await getEvent(input.eventId)
    const rows = decisionOutboxRows({
      template: await findEmailTemplate(
        input.eventId,
        decision === 'accept' ? TEMPLATE_KEYS.accepted : TEMPLATE_KEYS.rejected,
      ),
      eventId: input.eventId,
      eventName: event.name,
      eventSlug: event.slug,
      submissionId: submission.id,
      submissionTitle: submission.title,
      submissionCode: submission.code,
      decision,
      recipients: recipientsFor(submission, decision),
      // A preview is not a send, so this instant never reaches a row. It is here because
      // the renderer needs one to build a key it will not use.
      notifiedAt: new Date().toISOString(),
      keyEpoch: submission.notifiedAt ?? 'first',
      portalUrl: `${appUrl()}/portal`,
    })

    const first = rows.at(0)
    if (first === undefined) {
      return actionFailure(
        new AppError(ErrorIds.SUB_NO_RECIPIENTS, 'that submission has nobody to notify', {
          submissionId: submission.id,
          decision,
        }),
      )
    }

    return actionOk({
      toEmail: first.toEmail,
      subject: first.payload.subject,
      html: first.payload.html,
      recipientCount: rows.length,
      source: first.templateSource,
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The mapping is duplicated from `decisions.ts`, and it is four lines: exporting it
 * from there would widen a module that is entirely about WRITING decisions so a
 * read-only preview can borrow a mapper from it. The FILTER underneath it is not
 * duplicated any more, and that is the fix, not the tidiness: this and `decisions.ts`
 * now both call `decisionAudience`, so a decline preview and a decline send can no
 * longer disagree about who "the submitter" is. See `decision-audience.ts`.
 */
function recipientsFor(
  submission: Awaited<ReturnType<typeof getSubmission>>,
  decision: 'accept' | 'decline',
) {
  return decisionAudience(submission.participants, decision, submission.submitterId).map(
    (participant) => ({
      speakerId: participant.speakerId,
      email: participant.speaker.email,
      firstName: participant.speaker.firstName,
      lastName: participant.speaker.lastName,
    }),
  )
}
