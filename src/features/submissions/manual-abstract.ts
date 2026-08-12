'use server'

// The "+ Add Abstract" drawer's commit. An organizer entering a submission by hand.
//
// Distinct from the public CFP path in every way that matters: no form, no validation
// against `fieldsJson`, `source: 'manual'`, and the organizer picks the starting status.
// It shares only the DAL writes.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ParticipantRole, SubmissionStatus } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { MANUAL_DESCRIPTION_KEY } from '@/features/review/abstracts-rows'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createSubmission, scheduleSubmission } from '@/services/airtable/mutations'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import type { RecordId } from '@/types/domain'

/** The registry caps Title at 255, and the drawer shows a 0/255 counter against it. */
const TITLE_MAX = 255

export type ManualParticipantInput = {
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly role: ParticipantRole
}

export type ManualAbstractInput = {
  readonly eventId: RecordId
  readonly title: string
  readonly status: SubmissionStatus
  readonly description: string
  readonly capacity?: number
  readonly ceuCredits?: number
  readonly clientSessionId?: string
  readonly format?: string
  /**
   * Optional, and written by a second call.
   *
   * `SubmissionDraft` has no scheduling fields on purpose: scheduling is `scheduleFields`
   * in the DAL, because a drag in the agenda has to be able to CLEAR a room and a time,
   * which a create path never does. So the drawer's Starts At and Ends At go through the
   * schedule write, and a row with both set arrives `scheduled` rather than in the
   * unscheduled tray. Section 5.5.
   */
  readonly startsAt?: string
  readonly endsAt?: string
  /**
   * The first entry is the primary participant and becomes `submitter`.
   *
   * At least one is required, and that is a real constraint rather than a whim:
   * `Submissions.submitter` is a required link (schema section 3) and it is who the
   * acceptance email goes to. An abstract with nobody attached cannot be notified, so
   * the drawer asks for an email on the Participants tab instead of creating a row
   * that Notify would later have to skip.
   */
  readonly participants: readonly ManualParticipantInput[]
}

export async function createAbstractAction(
  input: ManualAbstractInput,
): Promise<ActionResult<{ submissionId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const title = input.title.trim()
    if (title.length === 0 || title.length > TITLE_MAX) {
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        `Title is required, up to ${TITLE_MAX} characters.`,
        {
          length: title.length,
        },
      )
    }

    const primary = input.participants.at(0)
    if (primary === undefined || primary.email.trim().length === 0) {
      throw new AppError(
        ErrorIds.SUB_ROLE_COUNT_INVALID,
        'Add at least one participant with an email address.',
      )
    }

    // Paired rather than two parallel arrays, so nothing indexes one by the other's
    // position. `security/detect-object-injection` is a build-failing warning here and
    // it is warning about the right thing: the pairing is the invariant.
    const cast = await Promise.all(
      input.participants.map(async (participant) => ({
        participant,
        speaker: await upsertSpeakerByEmail({
          email: participant.email.trim(),
          firstName: participant.firstName.trim(),
          lastName: participant.lastName.trim(),
          eventIds: [input.eventId],
        }),
      })),
    )

    const submitter = cast.at(0)?.speaker
    if (submitter === undefined) {
      throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'speaker upsert returned nothing')
    }

    const submission = await createSubmission({
      draft: {
        eventId: input.eventId,
        submitterId: submitter.id,
        title,
        status: input.status,
        source: 'manual',
        reviewRequired: reviewRequiredFor(input.status),
        // Keyed by the registry key, not a form field id, because there is no form.
        // abstracts-rows.ts reads it back through the same constant.
        answers: { [MANUAL_DESCRIPTION_KEY]: input.description },
        format: input.format,
        capacity: input.capacity,
        ceuCredits: input.ceuCredits,
        clientSessionId: input.clientSessionId,
        submittedAt: new Date().toISOString(),
      },
      participants: cast.map((entry, index) => ({
        speakerId: entry.speaker.id,
        role: entry.participant.role,
        isPrimary: index === 0,
        sortOrder: index + 1,
      })),
    })

    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      await scheduleSubmission({
        submissionId: submission.id,
        eventId: input.eventId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        scheduleStatus:
          input.startsAt !== undefined && input.endsAt !== undefined ? 'scheduled' : 'unscheduled',
      })
    }

    return actionOk({ submissionId: submission.id })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Section 5.1b stamps `reviewRequired` at creation and never re-reads it, so this is a
 * decision the drawer makes once. An abstract an organizer files as Pending is going
 * through review; one they file as Accepted is a confirmed speaker they typed in, which
 * is the sessions case, and dragging it into a review queue later would be wrong.
 */
function reviewRequiredFor(status: SubmissionStatus): boolean {
  return status === 'draft' || status === 'pending'
}
