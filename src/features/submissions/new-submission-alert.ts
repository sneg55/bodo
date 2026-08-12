// The `submission.admin_new` trigger: tell `Forms.adminAlertOnNew` that one arrived.
//
// BUILD_SPEC 5.3 lists this alert, and the builder's notifications step has shipped its
// recipient input since the day the builder landed, but nothing ever enqueued anything for
// it: the column was written by the organizer and read by nobody. Verified before writing
// this, not assumed, because it is a surprising gap: `idempotencyKeys.confirmation` and the
// `submission.admin_new` trigger kind both existed with no call site anywhere in `src`.
//
// So this is what makes the "New Submission Alert" template in the builder a template that
// SENDS, rather than a control whose value nothing reads, which is the failure this project
// avoids on purpose. The row shape, the per-recipient key, the dedupe and the stored-template
// lookup are all `@/features/comms/admin-alert`, shared with the update alert.
//
// Its own file rather than more of ./actions.ts, which is at the 300-line hook limit.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { adminAlertRows } from '@/features/comms/admin-alert'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { enqueueOutbox } from '@/features/submissions/decision-outbox'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { Event, RecordId, Speaker } from '@/types/domain'
import type { Form } from '@/types/forms'
import { appUrl } from '@/utils/env'

export type NewSubmissionAlertInput = {
  /** The full record, not the public projection: the trigger reads `adminAlertOnNew`. */
  readonly form: Form
  readonly event: Event
  readonly submissionId: RecordId
  readonly code: string
  readonly title: string
  /** The submitter, named in the body so the organizer knows who sent it. */
  readonly submitter: Speaker
}

/**
 * Queue the alert, or do nothing.
 *
 * Called AFTER the submission has been written, which is the opposite order to Notify (see
 * decisions.ts) and for the same reason read the other way round: there the email IS the
 * action, so a queued row with no status change is recoverable. Here the submission is the
 * action and the alert reports a fact, so telling an organizer about a submission that did
 * not land would send them looking for an abstract that does not exist.
 *
 * A failure is SWALLOWED with its id logged, and this is the one place in the CFP path where
 * that is the right call. The submission has committed and the speaker is about to be shown
 * their code; raising here would show them a failure and they would submit again, and there
 * is no key for the outbox or the DAL to collapse that duplicate against. A missed alert is
 * recoverable from the abstracts list, a duplicate submission is not.
 */
export async function alertAdminsOnNewSubmission(input: NewSubmissionAlertInput): Promise<void> {
  // The gate section 5.3 states: a non-empty recipient list is what switches this trigger
  // on. An unconfigured form is not an error, and it costs no reads.
  if (input.form.adminAlertOnNew.length === 0) return

  try {
    await enqueueOutbox(
      adminAlertRows({
        kind: 'new',
        eventId: input.event.id,
        eventName: input.event.name,
        eventSlug: input.event.slug,
        submissionId: input.submissionId,
        submissionTitle: input.title,
        submissionCode: input.code,
        recipients: input.form.adminAlertOnNew,
        actor: { name: nameOf(input.submitter), email: input.submitter.email },
        // One instant, used as `sendAt`. NOT part of the key: `alert-new:<submissionId>` has
        // no time component because a submission is created once, so a retried enqueue
        // computes the same key and writes nothing.
        at: new Date().toISOString(),
        // The organizer's destination is the submission in the admin app, which is what the
        // merge context's single link slot carries for an admin alert.
        linkUrl: `${appUrl()}/admin/${input.event.id}/abstracts`,
        // Their own body when they have written one, the built-in markdown default when they
        // have not. Read through the cached, tagged list (reads-comms.ts), so a busy form
        // does not spend an Airtable round trip per submission on it.
        template: await findEmailTemplate(input.event.id, TEMPLATE_KEYS.adminNew),
      }),
    )
  } catch (error) {
    console.warn(
      `[${ErrorIds.MAIL_SEND_FAIL}] admin_new alert not queued for ${input.code}: ${describe(error)}`,
    )
  }
}

function nameOf(speaker: Speaker): string {
  return [speaker.firstName, speaker.lastName].filter((part) => part.trim() !== '').join(' ')
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
