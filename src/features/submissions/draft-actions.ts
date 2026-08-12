'use server'

// Save an in-progress public submission as a real `draft` row, bound to the submitter.
//
// WHY THIS IS A SERVER WRITE AT ALL. The wizard has persisted to localStorage since it
// shipped and says so in the footer, and the CFP-07 evaluation confirmed the mechanism
// works: type a title, navigate away, come back, it is still there. What it also said is
// the part localStorage cannot answer: the draft "is not bound to the submitter's account
// and would not survive a different browser or device". That is true, and it is not
// fixable on the client at any price.
//
// WHY THIS IS NOT A NEW MECHANISM. Every downstream piece of a server-side draft was
// already built and had no producer until now:
//
//   - `draft` is a `SubmissionStatus` and sits in `SPEAKER_EDITABLE_STATUSES`;
//   - `submissionEditPermission` gives a draft the `full` edit mode with copy written for
//     exactly this state ("Nothing has been submitted yet...");
//   - the portal has a Submit control that flips a draft to `pending` IN PLACE, which is
//     why saving one here cannot produce a second row at submit time;
//   - `draftReminderRows` is a cron that mails a speaker before the form closes if their
//     draft is still unsubmitted, and it has been sweeping an empty list;
//   - the organizer's Abstracts table already has a "Drafts" tab.
//
// There are two resume paths and they answer different questions. On ANOTHER device, sign
// in at /login with the address the draft was saved under and it is in the portal; that is
// what makes it survive a device, and /login already says "Enter the email address you
// submitted with". In THIS browser, the form URL itself puts the answers back, because the
// wizard keeps its localStorage copy after a save instead of deleting it, and Submit then
// promotes the same row rather than filing a second one (./draft-promote.ts). The second
// path is the one CFP-07 asks for: it needs no email round trip at all.
//
// ABUSE, since this is an unauthenticated endpoint that creates records. The bound is
// stated rather than assumed, and every part of it already governs `submitCfp`:
//
//   1. a syntactically valid email is REQUIRED, because it is the binding key;
//   2. the per-email submission cap is re-counted on create, and drafts already count
//      against it (BUILD_SPEC 5.1), so this adds no row capacity an attacker did not
//      already have through the submit endpoint;
//   3. one draft per (submitter, form): a second save UPDATES the first, so pressing the
//      button is idempotent and cannot inflate anything;
//   4. the public form gate is re-applied, so a closed or unpublished form refuses;
//   5. `hasDraftContent` refuses to create a record for somebody who typed only an
//      address;
//   6. NO EMAIL IS SENT. That is the one genuinely new primitive a public draft endpoint
//      could hand an attacker ("mail this address on demand"), and declining to send it
//      is what keeps it off the table. The reminder cron mails the address later, but
//      only for a draft that exists, only near the form's close date, and idempotently
//      on `idempotencyKey`.

import { AppError, type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { submitterBinding, UNPROVEN_SUBMITTER_MESSAGE } from '@/features/auth/submitter-identity'
import { sessionSubject } from '@/features/auth/wiring'
import type { Problem } from '@/features/forms/validate'
import { draftCast } from '@/features/submissions/draft-cast'
import {
  hasDraftContent,
  identityProblems,
  prepareDraft,
} from '@/features/submissions/draft-prepare'
import { writeDraftSubmission } from '@/features/submissions/draft-write'
import { parseSubmitPayload } from '@/features/submissions/payload'
import { resolvePublicForm } from '@/features/submissions/public-form'
import { grantDraftClaim, readDraftClaim } from '@/features/submissions/submitter-context'
import { findSpeakerByEmail } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type SaveDraftSuccess = {
  ok: true
  /** `SESS-<n>`: the handle the portal lists it under. */
  code: string
  submissionId: RecordId
  /** True when this save updated a draft that already existed under this address. */
  updated: boolean
}

export type SaveDraftFailure = {
  ok: false
  errorId: ErrorId
  message: string
  problems: readonly Problem[]
}

export type SaveDraftResult = SaveDraftSuccess | SaveDraftFailure

const GENERIC_FAILURE =
  'Something went wrong while saving this draft. Try again, and contact the organizer if it keeps happening.'

const FAILURE_COPY: ReadonlyMap<ErrorId, string> = new Map([
  [
    ErrorIds.SUB_FORM_CLOSED,
    'This form has closed, so a draft can no longer be saved against it. Contact the organizer if you think this is a mistake.',
  ],
  [
    ErrorIds.SUB_LIMIT_REACHED,
    'You have reached the submission limit for this form, so there is no room for another draft. Withdraw one from your portal to free a slot.',
  ],
  [
    ErrorIds.SUB_VALIDATION_FAIL,
    'Something in the draft could not be read. Reload the page and try again.',
  ],
])

export async function saveCfpDraft(input: {
  eventSlug: string
  formPublicId: string
  payload: unknown
}): Promise<SaveDraftResult> {
  try {
    return await runSaveDraft(input)
  } catch (error) {
    if (!isAppError(error)) throw error
    // Same handling as `submitCfp`: logged with the id so it is greppable, then turned
    // into copy, because a thrown AppError out of a Server Action reaches the browser as
    // an opaque digest that tells the speaker nothing.
    console.warn(error.toLogLine())
    return {
      ok: false,
      errorId: error.id,
      message: FAILURE_COPY.get(error.id) ?? GENERIC_FAILURE,
      problems: [],
    }
  }
}

async function runSaveDraft(input: {
  eventSlug: string
  formPublicId: string
  payload: unknown
}): Promise<SaveDraftResult> {
  const payload = parseSubmitPayload(input.payload)
  const resolved = await resolvePublicForm({
    publicId: input.formPublicId,
    eventSlug: input.eventSlug,
    now: new Date(),
  })
  // The page gate and this one are the same function, for the same reason the submit
  // gate is: a closed form that accepts a write is data nobody asked for.
  if (!resolved.open) {
    throw new AppError(ErrorIds.SUB_FORM_CLOSED, 'draft save rejected by the public form gate', {
      publicId: input.formPublicId,
      reason: resolved.reason,
    })
  }

  const email = payload.email.trim().toLowerCase()
  const identity = identityProblems(payload.email)
  if (identity.length > 0) {
    return {
      ok: false,
      errorId: ErrorIds.SUB_VALIDATION_FAIL,
      message: 'A draft is saved against your email address, so that has to be filled in first.',
      problems: identity,
    }
  }

  // The same identity guard the submit applies, and this path needs it MORE, not less.
  // `findOwnDraft` keys on the submitter's email, so without it an anonymous POST can
  // rewrite the title, answers, track and cast of a draft belonging to whoever owns that
  // address, and `upsertSpeakerByEmail` writes the typed name over their profile on the way
  // through. See @/features/auth/submitter-identity for the rule and its tradeoff.
  const existingSubmitter = await findSpeakerByEmail(email)
  const claimedSpeakerId = await readDraftClaim()
  const binding = submitterBinding({
    existingSpeakerId: existingSubmitter?.id,
    subject: await sessionSubject(),
    claimedSpeakerId,
  })
  if (binding.kind === 'unproven') {
    return {
      ok: false,
      errorId: ErrorIds.SUB_UNVERIFIED_SUBMITTER,
      message: UNPROVEN_SUBMITTER_MESSAGE,
      problems: [],
    }
  }

  const prepared = prepareDraft({ form: resolved.form, payload })
  if (!prepared.ok) {
    return {
      ok: false,
      errorId: ErrorIds.SUB_VALIDATION_FAIL,
      message: 'Some answers have to be fixed before this can be saved, even as a draft.',
      problems: prepared.problems,
    }
  }
  if (!hasDraftContent({ title: prepared.prepared.columns.title, answers: payload.answers })) {
    return {
      ok: false,
      errorId: ErrorIds.SUB_VALIDATION_FAIL,
      message: 'There is nothing to save yet. Add a title or answer a question first.',
      problems: [],
    }
  }

  // The cast, which a draft carries now that the portal roster can correct one. Refused
  // rather than trimmed when it breaks the form's role rules, because those are the rules
  // the submit will apply to the same row: silently dropping the third co-speaker would
  // store a cast the speaker cannot see is wrong until they try to submit it.
  const cast = draftCast({ form: resolved.form, payload, eventId: resolved.event.id })
  if (!cast.ok) {
    return {
      ok: false,
      errorId: ErrorIds.SUB_VALIDATION_FAIL,
      message: 'The participants on this submission have to be fixed before it can be saved.',
      problems: cast.problems,
    }
  }

  const outcome = await writeDraftSubmission({
    prepared: prepared.prepared,
    // The address the binding above was resolved for, so `outcome.submitterId` is the row
    // this request proved or created, and the claim granted below can only ever name that
    // row. It used to be whichever participant the payload flagged primary.
    submitter: { email, firstName: payload.firstName, lastName: payload.lastName },
    cast: cast.participants,
    form: resolved.form,
    event: resolved.event,
  })

  // The whole point of the credential, and the narrowest condition that closes the trap
  // this endpoint used to set. `create` means no Speakers row existed for this address when
  // the binding was resolved a few lines up, so the row this browser is now being given a
  // claim for is the row this same request made. The second arm only refreshes a claim the
  // request already presented for the same record, so neither arm can hand out proof of a
  // record that was there first. See @/features/auth/submitter-identity.
  if (binding.kind === 'create' || claimedSpeakerId === outcome.submitterId) {
    await grantDraftClaim(outcome.submitterId)
  }

  // `submitterId` is deliberately not part of the answer: the wizard has no use for a
  // record id, and the claim it needs travels as an httpOnly cookie.
  return {
    ok: true,
    code: outcome.code,
    submissionId: outcome.submissionId,
    updated: outcome.updated,
  }
}
