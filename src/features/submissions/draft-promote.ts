// Turning the draft a speaker already saved into the submission they just pressed Submit on,
// in place, and the add-only cast reconciliation both the promote and a repeat draft save use.
//
// WHY THIS EXISTS. Save & finish later used to be terminal in the wizard: the card replaced
// the form and the browser's copy of the answers was deleted, so the only way back in was the
// portal, behind a magic link. That is the CFP-07 gap ("returning to the form URL restores
// nothing"), and the reason it was built that way is stated in DraftSavedCard: the draft IS a
// record now, so a wizard left open behind the card would file a SECOND row on Submit and
// leave the organizer two half-submissions to reconcile.
//
// Making the form resumable therefore has to answer the same objection, and this is the
// answer: the submit finds the draft the same way a second save does, keyed on (submitter,
// form, status=draft), and moves that row rather than creating another. One abstract stays
// one row however many times it is saved, and the per-form cap stops counting a draft against
// the submit that promotes it.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never REMOVES anybody from the cast. The roster belongs
// to the authenticated portal editor after creation (`roster-edit.ts`), and a public endpoint
// that reconciled the cast both ways would let a stale wizard tab in one browser delete a
// co-speaker somebody curated while signed in. Adding is safe and is what a resumable form
// needs: without it, the co-author typed in on the visit AFTER the draft was saved is dropped
// with nothing said.

import type { PreparedParticipant, PreparedSubmission } from '@/features/submissions/prepare'
import { setSubmissionStatus } from '@/services/airtable/mutations'
import { updateSubmission } from '@/services/airtable/mutations-content'
import { addSubmissionParticipant } from '@/services/airtable/mutations-participants'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { getSubmission } from '@/services/airtable/queries'
import type { RecordId, Speaker, Submission } from '@/types/domain'

export type PromoteInput = {
  /** The `draft` row this submitter already has against this form. */
  draft: Submission
  prepared: PreparedSubmission
  /** The one address this request proved, threaded on for `profileWrites`. */
  submitterEmail: string
  /**
   * The cast, already upserted by the caller and keyed the way `upsertSpeakers` keys it.
   * Passed rather than re-resolved so a promote does not upsert every co-speaker twice.
   */
  speakers?: ReadonlyMap<string, Speaker>
}

/**
 * The promoted row's identity, in the shape `runSubmit` needs to answer the browser and to
 * address the confirmation email.
 */
export type PromoteOutcome = { id: RecordId; code: string; submitterId: RecordId }

export async function promoteDraftToSubmission(input: PromoteInput): Promise<PromoteOutcome> {
  const { draft, prepared } = input
  const eventId = draft.eventId

  await updateSubmission({
    submissionId: draft.id,
    eventId,
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
    submissionId: draft.id,
    eventId,
    cast: prepared.participants,
    submitterEmail: input.submitterEmail,
    speakers: input.speakers,
  })

  // Through `pending` even when the lifecycle lands somewhere else, and it is not
  // ceremony: `statusFields` stamps the Submitted column only on the FIRST move into
  // `pending`, so a `sessions` form, which lands `accepted`, would otherwise promote with
  // an empty submit date. The create path gets the stamp for free because it writes
  // `submittedAt` inline on the new record.
  await setSubmissionStatus({
    submissionId: draft.id,
    eventId,
    status: 'pending',
    submittedAt: new Date().toISOString(),
  })
  if (prepared.status !== 'pending') {
    await setSubmissionStatus({ submissionId: draft.id, eventId, status: prepared.status })
  }

  return { id: draft.id, code: draft.code, submitterId: draft.submitterId }
}

/**
 * Attach anyone in the wizard's cast who is not on the row yet, and touch nobody who is.
 *
 * `profileWrites` carries the same rule `upsertSpeakers` states: the submitter's own address
 * is the only profile a public write may overwrite. A co-presenter who already has a record
 * is linked to the event and otherwise left exactly as they are.
 */
export async function addMissingParticipants(input: {
  submissionId: RecordId
  eventId: RecordId
  cast: readonly PreparedParticipant[]
  submitterEmail: string
  /** Already-resolved rows, keyed by `draft.email`. Missing entries are upserted here. */
  speakers?: ReadonlyMap<string, Speaker>
}): Promise<void> {
  const missing = input.cast.filter((participant) => !participant.isPrimary)
  if (missing.length === 0) return

  const current = await getSubmission(input.submissionId)
  const attached = new Set(
    current.participants.map((participant) => participant.speaker.email.trim().toLowerCase()),
  )
  const proven = input.submitterEmail.trim().toLowerCase()
  let sortOrder = current.participants.length

  for (const participant of missing) {
    const email = participant.draft.email.trim().toLowerCase()
    if (email === '' || attached.has(email)) continue
    attached.add(email)
    sortOrder += 1

    const speaker =
      input.speakers?.get(participant.draft.email) ??
      (await upsertSpeakerByEmail(participant.draft, 'action', {
        profileWrites: email === proven,
      }))
    await addSubmissionParticipant({
      submissionId: input.submissionId,
      eventId: input.eventId,
      speakerId: speaker.id,
      draft: {
        speakerId: speaker.id,
        role: participant.role,
        // Never here. The primary participant is written once, at creation, and a second
        // one would give the roster two people flagged as presenting it. It is NOT the same
        // thing as `Submissions.submitter`, which is the address the request proved and is
        // resolved by `submitterSpeaker`; conflating the two was an impersonation hole.
        isPrimary: false,
        sortOrder,
      },
    })
  }
}
