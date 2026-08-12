// The `submission.confirmation` trigger: the email a submitter gets after a successful submit.
//
// BUILD_SPEC 5.3 lists it, the builder's step 7 has shipped its toggle and its body editor
// since the builder landed, and the parity doc marks it the organizer's "must have". Nothing
// enqueued it. Verified before writing this rather than assumed, because it is a surprising
// gap: `idempotencyKeys.confirmation` existed with no call site anywhere in `src`, and
// `Forms.confirmationEmailHtml` was written by the builder and read by nothing.
//
// This is the one body in the system whose provenance is neither a code default nor an
// `EmailTemplates` row: the organizer authors it ON THE FORM, in the rich text editor on step
// 7, and it is stored as HTML in `Forms.confirmationEmailHtml`. `EmailOutbox.templateSource`
// has a value for exactly that, `form_inline`, and this is what writes it. Which means the
// three labels now each have a writer and a reader can tell the three apart: `template` for a
// stored row, `form_inline` for a body authored on the form, `system` for one written in code.
//
// Like every other trigger it ENQUEUES and returns. Nothing here sends.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { resolveTemplate } from '@/features/comms/resolve-template'
import { idempotencyKeys } from '@/features/comms/triggers'
import { enqueueOutbox } from '@/features/submissions/decision-outbox'
import type { Event, RecordId, Speaker } from '@/types/domain'
import type { Form } from '@/types/forms'
import { appUrl } from '@/utils/env'

/**
 * The portal link, appended to whatever the organizer wrote.
 *
 * Appended rather than expected inside the body, which is the contract the editor's own help
 * text states ("The portal access link is appended by the sender, so it does not need to be
 * written here"). An organizer who deletes the link out of their body must still send a
 * submitter something they can act on: the confirmation email is what turns a submitter into
 * a portal user, and one without a link is a dead end.
 */
const PORTAL_LINK = '<p><a href="{{portalUrl}}">{{portalUrl}}</a></p>'

/**
 * What was submitted, appended by the sender for the same reason the portal link is.
 *
 * A confirmation that does not name the talk is not a receipt. The body read "We got your
 * submission. Manage it any time from your speaker portal." plus a link, which is equally
 * true of every submission anybody has ever made: a speaker who sent three proposals got
 * three identical emails and could not tell which had arrived, or whether the one they
 * cared about had. That is what cost this item its pass.
 *
 * Appended rather than merged into the organizer's body, which is theirs and is not
 * rewritten for them. The precedent is `PORTAL_LINK` directly above: the sender adds what
 * the submitter must have regardless of what the organizer chose to write. The code comes
 * with it, because that is the string every later email and the portal itself quote back.
 */
const SUBMISSION_SUMMARY =
  '<p><strong>{{submission.title}}</strong><br>Reference: {{submission.code}}</p>'

/**
 * Used only when the organizer emptied the body. Deliberately not imported from
 * `@/features/forms/builder/defaults`: that constant is the value the BUILDER seeds a new
 * form with, and this is what the SENDER does with a form whose body is blank. They read the
 * same today and they answer different questions, so coupling them would make an editorial
 * change to the builder's seed silently change what an existing form mails.
 */
const FALLBACK_BODY = '<p>We got your submission. Manage it any time from your speaker portal.</p>'

export type ConfirmationEmailInput = {
  readonly form: Form
  readonly event: Event
  readonly submissionId: RecordId
  readonly code: string
  readonly title: string
  readonly submitter: Speaker
  /** Whether the submission still has to be reviewed. Only the SUBJECT reflects it. */
  readonly reviewRequired: boolean
}

/**
 * Queue the confirmation, or do nothing.
 *
 * Called after the submission has been written, and its failure never fails the submit, for
 * the reason ./new-submission-alert gives at length: the speaker is about to be shown their
 * code, and raising here would have them submit again with no key for the outbox to collapse
 * the duplicate against. A missed confirmation is recoverable, a duplicate submission is not.
 */
export async function sendSubmissionConfirmation(input: ConfirmationEmailInput): Promise<void> {
  // The gate is the organizer's toggle. An event that switched confirmations off means it.
  if (!input.form.confirmationEmailEnabled) return
  if (input.submitter.email.trim() === '') return

  try {
    await enqueueOutbox([confirmationRow(input)])
  } catch (error) {
    console.warn(
      `[${ErrorIds.MAIL_SEND_FAIL}] confirmation not queued for ${input.code}: ${describe(error)}`,
    )
  }
}

function confirmationRow(input: ConfirmationEmailInput) {
  const body = (input.form.confirmationEmailHtml ?? '').trim()

  const resolved = resolveTemplate({
    // No `EmailTemplates` row is consulted, and that is the point of this trigger rather than
    // an omission: the body belongs to the FORM, one event can run three calls for papers
    // with three different confirmations, and a single event-scoped row could not express
    // that. The panel that edits this is "Submitter notifications", not "Admin notifications".
    stored: undefined,
    fallbackSource: 'form_inline',
    context: {
      speaker: {
        firstName: greetingName(input.submitter),
        lastName: input.submitter.lastName,
        email: input.submitter.email,
      },
      event: { name: input.event.name, slug: input.event.slug },
      submission: { code: input.code, title: input.title },
      portalUrl: `${appUrl()}/portal`,
    },
    fallback: {
      // The one thing `reviewRequired` changes. The BODY is the organizer's and is not
      // rewritten for them: a form that reviews everything and a form that accepts on submit
      // are the same email as far as the stored body is concerned, and the difference the
      // submitter needs is whether to expect a decision.
      // Named, so an inbox listing three confirmations from the same event distinguishes
      // them. The event stays in it because a speaker submits to more than one conference.
      subject: input.reviewRequired
        ? `We received "${input.title}" for ${input.event.name}`
        : `"${input.title}" is confirmed for ${input.event.name}`,
      html: `${body === '' ? FALLBACK_BODY : body}${SUBMISSION_SUMMARY}${PORTAL_LINK}`,
      attachIcs: false,
    },
  })

  return {
    eventId: input.event.id,
    kind: 'submission.confirmation' as const,
    toEmail: input.submitter.email,
    // `confirm:<submissionId>`, with no time component, because a submission is created once:
    // a retried enqueue computes the same key and the DAL's read-then-upsert writes nothing.
    idempotencyKey: idempotencyKeys.confirmation(input.submissionId),
    templateSource: resolved.templateSource,
    formId: input.form.id,
    speakerId: input.submitter.id,
    submissionId: input.submissionId,
    sendAt: new Date().toISOString(),
    payload: resolved.payload,
  }
}

/**
 * `renderTemplate` counts an empty merge value as one the context cannot supply and raises, so
 * a Speakers row with no first name would otherwise turn a landed submission into a logged
 * failure and the submitter would never hear. Degrades the same way `decisionOutboxRows` does.
 */
function greetingName(speaker: Speaker): string {
  const first = speaker.firstName.trim()
  if (first !== '') return first
  const last = speaker.lastName.trim()
  return last === '' ? 'there' : last
}

function describe(error: unknown): string {
  if (isAppError(error)) return error.toLogLine()
  if (error instanceof Error) return error.message
  return String(error)
}
