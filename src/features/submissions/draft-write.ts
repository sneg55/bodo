// The write half of a save-and-finish-later. Split from `draft-actions.ts` for the line
// limit; that file owns the gate and the copy, this one owns the records.
//
// Create-or-update, keyed on (submitter, form) and restricted to `status=draft`, so
// pressing the button twice cannot produce two rows and a SUBMITTED row can never be
// reopened by a public endpoint. That last one is the line between "save my draft" and
// "edit my submission": the second is the portal's, behind a session.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { resolveSubmissionLimit } from '@/features/submissions/banner'
import type { PreparedDraft } from '@/features/submissions/draft-prepare'
import { addMissingParticipants } from '@/features/submissions/draft-promote'
import type { PreparedParticipant } from '@/features/submissions/prepare'
import type { SubmitterIdentity } from '@/features/submissions/submit-cast'
import { submitterSpeaker } from '@/features/submissions/submit-cast'
import { invalidate } from '@/services/airtable/invalidate'
import { createSubmission } from '@/services/airtable/mutations'
import { updateSubmission } from '@/services/airtable/mutations-content'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { findSpeakerByEmail, listSubmissions } from '@/services/airtable/queries'
import { eventSpeakersTag } from '@/services/airtable/tags'
import type { ParticipantDraft } from '@/services/airtable/to-fields'
import type { Event, RecordId, Speaker, Submission } from '@/types/domain'
import type { Form } from '@/types/forms'

export type DraftWriteInput = {
  prepared: PreparedDraft
  /**
   * The Account step. `email` is the key the draft is bound to and the one address this
   * request proved; the name beside it is only read when the submitter put somebody else in
   * every participant row. Normalized here rather than assumed to arrive that way.
   */
  submitter: SubmitterIdentity
  /** From `draftCast`. Holds exactly one primary, who is whoever the payload said. */
  cast: readonly PreparedParticipant[]
  form: Form
  event: Event
}

export type DraftWriteOutcome = {
  code: string
  submissionId: RecordId
  /** True when this save updated a draft that already existed under this address. */
  updated: boolean
  /**
   * The Speakers row this draft is filed under.
   *
   * Returned so `saveCfpDraft` can hand the browser a draft claim for a record this same
   * request just created. Never sent to the client: the wizard has no use for a record id
   * and the claim is a cookie. See `@/features/auth/submitter-identity`.
   */
  submitterId: RecordId
}

export async function writeDraftSubmission(input: DraftWriteInput): Promise<DraftWriteOutcome> {
  const { prepared, form, event } = input
  const email = input.submitter.email.trim().toLowerCase()
  const existing = await findOwnDraft({ email, eventId: event.id, formId: form.id })

  if (existing !== undefined) {
    // The BODY is rewritten wholesale and the cast is only ever ADDED to. That asymmetry is
    // the boundary, and it is the same one the promote in ./draft-promote.ts keeps: after
    // creation the roster belongs to the portal's editor (`roster-edit.ts`), which is
    // authenticated and checks ownership per mutation, so a stale public wizard tab must
    // never be able to DELETE a co-speaker somebody curated while signed in. It may still
    // add the co-author the speaker typed into the wizard on this visit, which is what a
    // resumable form has to do or the second co-speaker is silently dropped.
    await updateSubmission({
      submissionId: existing.id,
      eventId: event.id,
      title: prepared.title,
      answers: prepared.answers,
      format: prepared.columns.format,
      level: prepared.columns.level,
      language: prepared.columns.language,
      ceuCredits: prepared.columns.ceuCredits,
      trackId: prepared.trackId,
      tagIds: prepared.columns.tagIds,
    })
    await addMissingParticipants({
      submissionId: existing.id,
      eventId: event.id,
      cast: input.cast,
      submitterEmail: email,
    })
    return {
      code: existing.code,
      submissionId: existing.id,
      updated: true,
      submitterId: existing.submitterId,
    }
  }

  await assertUnderCap({ email, event, form })
  const speakers = await upsertCast(input.cast, email)
  // The proven address's row, never whichever participant the payload flagged primary. This
  // path needs the distinction MORE than the submit does: `saveCfpDraft` hands the browser a
  // draft claim for whatever comes back here, so filing under a flagged stranger minted proof
  // of that stranger's record. See `submitterSpeaker`.
  const submitter = await submitterSpeaker({
    speakers,
    submitter: input.submitter,
    eventId: event.id,
  })

  const submission = await createSubmission({
    draft: {
      eventId: event.id,
      formId: form.id,
      submitterId: submitter.id,
      title: prepared.title,
      status: 'draft',
      source: 'form',
      reviewRequired: prepared.reviewRequired,
      answers: prepared.answers,
      format: prepared.columns.format,
      level: prepared.columns.level,
      language: prepared.columns.language,
      ceuCredits: prepared.columns.ceuCredits,
      trackId: prepared.trackId,
      tagIds: prepared.columns.tagIds,
      // No `submittedAt`: nothing has been submitted. `setSubmissionStatus` stamps it on
      // the way into `pending`, which is where the portal's Submit takes this row.
    },
    // Never empty: `draftsOf` in reminders-wiring.ts drops a draft with no participant row,
    // so a draft without one is a draft nobody is ever nudged about before the form closes.
    participants: participantDrafts(input.cast, speakers),
  })

  // `createSubmission` expires the submission and submitter tags, and `upsertSpeakerByEmail`
  // expires `speaker:{id}` and `event:{id}:speakers` per person through `afterSpeakerWrite`.
  // This is the belt to that braces: a draft whose `eventIds` came back empty would leave
  // the admin speaker list stale, and the list is where a new co-speaker has to appear.
  invalidate('action', { own: [eventSpeakersTag(event.id)] })

  return {
    code: submission.code,
    submissionId: submission.id,
    updated: false,
    submitterId: submitter.id,
  }
}

/**
 * Speakers keyed by the email they were upserted under, matching `upsertSpeakers` on the
 * submit path. Sequential because the DAL's per-base scheduler rate-limits anyway, and a
 * find-or-create racing itself is exactly how one person ends up with two records a few
 * hundred milliseconds apart.
 *
 * `submitterEmail` carries the same rule the submit path states in `submit-cast.ts`: it is
 * the one address this request proved, and the only one whose existing profile may be
 * overwritten. A co-presenter named on somebody else's draft is linked to the event and
 * otherwise left alone.
 */
async function upsertCast(
  cast: readonly PreparedParticipant[],
  submitterEmail: string,
): Promise<ReadonlyMap<string, Speaker>> {
  const speakers = new Map<string, Speaker>()
  const proven = submitterEmail.trim().toLowerCase()

  for (const participant of cast) {
    const email = participant.draft.email
    if (speakers.has(email)) continue
    speakers.set(
      email,
      await upsertSpeakerByEmail(participant.draft, 'action', {
        profileWrites: email.trim().toLowerCase() === proven,
      }),
    )
  }
  return speakers
}

function participantDrafts(
  cast: readonly PreparedParticipant[],
  speakers: ReadonlyMap<string, Speaker>,
): readonly ParticipantDraft[] {
  const drafts: ParticipantDraft[] = []
  for (const participant of cast) {
    const speaker = speakers.get(participant.draft.email)
    if (speaker === undefined) continue
    drafts.push({
      speakerId: speaker.id,
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: participant.sortOrder,
    })
  }
  return drafts
}

/**
 * The unsubmitted draft this address already has against this form, if any.
 *
 * `submitterContext` answers the same question for the submit path, off the two reads it
 * was already making, so that pressing Submit on a resumed wizard PROMOTES this row instead
 * of filing a second one. The two must stay keyed identically: two readings of "which draft
 * is this" is exactly how a save and a submit end up on different records.
 */
async function findOwnDraft(input: {
  email: string
  eventId: RecordId
  formId: RecordId
}): Promise<Submission | undefined> {
  const speaker = await findSpeakerByEmail(input.email)
  if (speaker === undefined) return undefined
  const submissions = await listSubmissions(input.eventId)
  return submissions.find(
    (row) =>
      row.submitterId === speaker.id && row.formId === input.formId && row.status === 'draft',
  )
}

/**
 * The same cap `prepareSubmission` applies to a submit, counted the same way and off the
 * same two reads. Only on CREATE: updating a draft that is already one of the counted
 * rows must not be refused for the existence of itself.
 */
async function assertUnderCap(input: { email: string; event: Event; form: Form }): Promise<void> {
  const limit = resolveSubmissionLimit({
    formLimit: input.form.submissionLimit,
    eventLimit: input.event.submissionLimitPerUser,
  })
  if (limit === undefined) return

  const speaker = await findSpeakerByEmail(input.email)
  if (speaker === undefined) return
  const submissions = await listSubmissions(input.event.id)
  const existingCount = submissions.filter(
    (row) => row.submitterId === speaker.id && row.formId === input.form.id,
  ).length
  if (existingCount < limit) return

  throw new AppError(ErrorIds.SUB_LIMIT_REACHED, 'submission limit reached for this form', {
    publicId: input.form.publicId,
    limit,
    existingCount,
  })
}
