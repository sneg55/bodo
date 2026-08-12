'use server'

// The public CFP submit.
//
// A Server Action rather than a route handler, which is a deliberate departure from
// the "public CFP submission is a route handler so it works without JS" line in
// .claude/rules/bodo-conventions.md, and it is worth saying why. The wizard is five
// steps of conditional visibility, live combined-character counters, and a
// participant list with per-role minima: none of that renders without JavaScript, so
// a no-JS POST target would have nothing to post. The action is the only writer and it
// re-validates everything from scratch. If a no-JS single-page fallback is ever wanted,
// it is a second entry point calling `prepareSubmission`, not a change here.
//
// Everything the client sends is re-derived: the form comes from the DAL by publicId,
// the gate is re-applied, the cap is re-counted, and hidden answers are stripped
// before anything is stored. The payload contributes answers and nothing else.

import { AppError, type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { submitterBinding, UNPROVEN_SUBMITTER_MESSAGE } from '@/features/auth/submitter-identity'
import { hasSession, sessionSubject } from '@/features/auth/wiring'
import type { Problem } from '@/features/forms/validate'
import { resolveSubmissionLimit } from '@/features/submissions/banner'
import { sendSubmissionConfirmation } from '@/features/submissions/confirmation-email'
import { promoteDraftToSubmission } from '@/features/submissions/draft-promote'
import { alertAdminsOnNewSubmission } from '@/features/submissions/new-submission-alert'
import { parseSubmitPayload } from '@/features/submissions/payload'
import type { PreparedParticipant, PreparedSubmission } from '@/features/submissions/prepare'
import { prepareSubmission } from '@/features/submissions/prepare'
import { resolvePublicForm } from '@/features/submissions/public-form'
import type { SubmitterIdentity } from '@/features/submissions/submit-cast'
import {
  participantDrafts,
  submitterSpeaker,
  upsertSpeakers,
} from '@/features/submissions/submit-cast'
import { FAILURE_COPY, GENERIC_FAILURE } from '@/features/submissions/submit-copy'
import { readDraftClaim, submitterContext } from '@/features/submissions/submitter-context'
import { announceSubmissionCreated } from '@/features/webhooks/announce'
import { invalidate } from '@/services/airtable/invalidate'
import { createSubmission } from '@/services/airtable/mutations'
import { eventSpeakersTag } from '@/services/airtable/tags'
import type { Event, RecordId, Submission } from '@/types/domain'
import type { Form } from '@/types/forms'

export type SubmitFailure = {
  ok: false
  errorId: ErrorId
  message: string
  /** Field-level problems, so the wizard can put each one beside its control. */
  problems: readonly Problem[]
}

export type SubmitSuccess = {
  ok: true
  /** `SESS-<n>`, which is what the portal shows the speaker. */
  code: string
  submissionId: RecordId
  /** Whether the confirmation email said "you are confirmed" or "we will review". */
  reviewRequired: boolean
  /**
   * Whether the browser that submitted already holds a session.
   *
   * The success card offered "Continue to portal" and auto-redirected there after ten
   * seconds, which is right for a speaker submitting their second proposal and wrong for
   * the first-time submitter the flow is mostly for: `/portal` refuses them and they
   * arrive at a login screen they did not ask for, having just been told they were being
   * taken somewhere else. Filling in an email address on a public form is not a sign-in,
   * so the answer is to say so rather than to mint a session from it.
   */
  signedIn: boolean
}

export type SubmitResult = SubmitSuccess | SubmitFailure

export async function submitCfp(input: {
  eventSlug: string
  formPublicId: string
  payload: unknown
}): Promise<SubmitResult> {
  try {
    return await runSubmit(input)
  } catch (error) {
    if (!isAppError(error)) throw error
    // Logged with the id so the failure is greppable, then turned into copy. A
    // thrown AppError out of a Server Action reaches the browser as an opaque
    // digest, which tells the speaker nothing.
    console.warn(error.toLogLine())
    return {
      ok: false,
      errorId: error.id,
      message: FAILURE_COPY.get(error.id) ?? GENERIC_FAILURE,
      problems: [],
    }
  }
}

async function runSubmit(input: {
  eventSlug: string
  formPublicId: string
  payload: unknown
}): Promise<SubmitResult> {
  const payload = parseSubmitPayload(input.payload)
  const resolved = await resolvePublicForm({
    publicId: input.formPublicId,
    eventSlug: input.eventSlug,
    now: new Date(),
  })

  // The page gate and this one are the same function. A closed form that renders is
  // a bug; a closed form that accepts a POST is data loss.
  if (!resolved.open) {
    throw new AppError(ErrorIds.SUB_FORM_CLOSED, 'submit rejected by the public form gate', {
      publicId: input.formPublicId,
      reason: resolved.reason,
    })
  }

  const { form, event } = resolved

  // Who this address already is, and whether this request has proved it is them. Resolved
  // BEFORE anything is prepared or written, because the refusal has to write nothing at all.
  // See `submitter-identity.ts` for the hole this closes and the tradeoff it accepts.
  const submitter = await submitterContext({
    email: payload.email,
    eventId: event.id,
    formId: form.id,
  })
  const binding = submitterBinding({
    existingSpeakerId: submitter.existing?.id,
    subject: await sessionSubject(),
    // Possession of a claim this form issued when it created that record, which is what a
    // first-time submitter who pressed Save & finish later is holding. Without it, the row
    // their own draft created is a row they are then refused for.
    claimedSpeakerId: await readDraftClaim(),
  })
  if (binding.kind === 'unproven') {
    return {
      ok: false,
      errorId: ErrorIds.SUB_UNVERIFIED_SUBMITTER,
      message: UNPROVEN_SUBMITTER_MESSAGE,
      problems: [],
    }
  }

  // The draft this address already has against this form, which is what a resumed wizard is
  // sitting on top of. It is already one of `submitter.count`, so counting it against the
  // submit that PROMOTES it would refuse a speaker their own draft on any form with a limit
  // of one.
  const draft = submitter.draft

  const prepared = prepareSubmission({
    form,
    eventId: event.id,
    payload,
    now: new Date(),
    existingCount: submitter.count - (draft === undefined ? 0 : 1),
    limit: resolveSubmissionLimit({
      formLimit: form.submissionLimit,
      eventLimit: event.submissionLimitPerUser,
    }),
  })
  if (!prepared.ok) {
    return {
      ok: false,
      errorId: ErrorIds.SUB_VALIDATION_FAIL,
      message: 'Some answers need attention before this can be submitted.',
      problems: prepared.problems,
    }
  }

  return await write({
    prepared: prepared.prepared,
    form,
    event,
    submitter: {
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
    },
    draft,
  })
}

async function write(input: {
  prepared: PreparedSubmission
  /** The full record, not the public projection: the alert needs `adminAlertOnNew`. */
  form: Form
  event: Event
  /**
   * The Account step, and the one address this request proved. It decides two things and
   * both of them are the impersonation guard: whose existing profile may be written
   * (`upsertSpeakers`), and who the row is FILED under (`submitterSpeaker`). Everybody else
   * on the roster was merely NAMED by this submitter.
   */
  submitter: SubmitterIdentity
  /**
   * The submitter's own unsubmitted draft against this form, when the wizard was resumed
   * from one. Present means MOVE that row rather than create a second; see ./draft-promote.
   */
  draft?: Submission
}): Promise<SubmitResult> {
  const { prepared } = input
  const eventId = input.event.id
  if (prepared.unmapped.length > 0) {
    // A registry key with no column to write to. The answer is still stored in
    // answersJson, so this is a form-definition problem to fix rather than lost data.
    console.warn(
      `[${ErrorIds.SUB_VALIDATION_FAIL}] unmapped registry keys on submit: ${prepared.unmapped
        .map((entry) => entry.registryKey)
        .join(', ')}`,
    )
  }

  const speakers = await upsertSpeakers(prepared.participants, input.submitter.email)
  // The proven address's own row, NOT whichever participant carries `isPrimary`: those are
  // two different questions and answering the first with the second filed submissions under
  // people who never sent them. See `submitterSpeaker`.
  const submitter = await submitterSpeaker({
    speakers,
    submitter: input.submitter,
    eventId,
  })

  // Two ways to arrive at one submitted row, and which one runs is decided by whether this
  // submitter already has a draft against this form. Promoting is not an optimisation: the
  // wizard now restores itself from the browser after a Save & finish later, so a create
  // here would file a SECOND row for the abstract the speaker thinks they are finishing.
  const submission =
    input.draft === undefined
      ? await createSubmission({
          draft: {
            eventId,
            formId: input.form.id,
            submitterId: submitter.id,
            title: prepared.title,
            status: prepared.status,
            source: 'form',
            reviewRequired: prepared.reviewRequired,
            answers: prepared.answers,
            format: prepared.columns.format,
            level: prepared.columns.level,
            language: prepared.columns.language,
            ceuCredits: prepared.columns.ceuCredits,
            trackId: prepared.trackId,
            tagIds: prepared.columns.tagIds,
            submittedAt: new Date().toISOString(),
          },
          participants: participantDrafts(prepared.participants, speakers),
        })
      : await promoteDraftToSubmission({
          draft: input.draft,
          prepared,
          submitterEmail: input.submitter.email,
          speakers,
        })

  // `createSubmission` and the writes inside the promote expire the submission and submitter
  // tags themselves. The speaker LIST is this action's own doing, because a new participant
  // has to show up in the admin's speaker list, and `upsertSpeakerByEmail` invalidates
  // nothing.
  invalidate('action', { own: [eventSpeakersTag(eventId)] })

  // BUILD_SPEC 5.3's `submission.confirmation`, which is what turns a submitter into a portal
  // user, and 5.3's `submission.admin_new`. Both enqueue after the write and neither can fail
  // the submit: see the header of ./confirmation-email for why that asymmetry is right here.
  // Webhook subscribers hear about it on the same terms, and `announce.ts` says why.
  const { id, code } = submission
  await announceSubmissionCreated(eventId, { id, code, title: prepared.title })

  await sendSubmissionConfirmation({
    form: input.form,
    event: input.event,
    submissionId: submission.id,
    code: submission.code,
    title: prepared.title,
    submitter,
    reviewRequired: prepared.reviewRequired,
  })

  await alertAdminsOnNewSubmission({
    form: input.form,
    event: input.event,
    submissionId: submission.id,
    code: submission.code,
    title: prepared.title,
    submitter,
  })

  return {
    ok: true,
    code: submission.code,
    submissionId: submission.id,
    reviewRequired: prepared.reviewRequired,
    // Read AFTER the write, so a failure here cannot cost a submission that succeeded.
    // It only decides which of two sentences the confirmation card shows.
    signedIn: await hasSession(),
  }
}
