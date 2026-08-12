// The submission-body save, end to end. The Server Action in ./actions.ts is a wrapper
// over this and nothing else.
//
// The order of the first three steps is the security property, and it is the same order
// every other portal mutation uses: resolve the acting speaker, resolve the record as
// THEIRS, then re-derive the edit policy from that record. Only then is anything written.
// BUILD_SPEC 4: a Server Action is reachable by POST with no layout ever rendering, so the
// page having decided this submission was editable authorizes nothing.

import { ErrorIds } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import { TEMPLATE_KEYS } from '@/features/comms/template-keys'
import type { FormAnswers } from '@/features/forms/logic'
import { resolveOwnSubmission } from '@/features/portal/resolve-submission'
import { prepareBodyEdit } from '@/features/portal/submission-edit'
import { adminUpdateOutboxRows } from '@/features/portal/update-alert'
import { enqueueOutbox } from '@/features/submissions/decision-outbox'
import { updateSubmission } from '@/services/airtable/mutations-content'
import { getEvent, listForms } from '@/services/airtable/queries'
import { findEmailTemplate } from '@/services/airtable/reads-comms'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'
import { appUrl } from '@/utils/env'

export type SaveBodyInput = {
  /** `SESS-<n>`, the only handle the speaker's page ever holds. */
  code: string
  answers: FormAnswers
}

/**
 * Save an edited submission body, or say why not.
 *
 * Returns the message the form renders, matching the `guarded()` contract in ./actions.ts:
 * a string is a success and `{ failed }` is a refusal the speaker can act on. A frozen
 * submission raises instead, from `prepareBodyEdit`, because it is a condition of the
 * record rather than a mistake in a field.
 */
export async function saveSubmissionBody(
  input: SaveBodyInput,
): Promise<string | { failed: string }> {
  const { speakerId } = await requireSpeaker()
  const submission = await resolveOwnSubmission({ speakerId, code: input.code })
  // The submission's own event, so the organizer alert, the form lookup and the tags this
  // write expires all name the conference the record is actually on. Reading the configured
  // one alerted the wrong organizers and invalidated the wrong caches.
  const eventId = submission.eventId

  const [event, forms] = await Promise.all([getEvent(eventId), listForms(eventId)])
  const form = forms.find((candidate) => candidate.id === submission.formId)

  // One instant for the write and for the alert's idempotency key, taken before either.
  // Reading the clock twice would key a retry differently from the save it belongs to.
  const now = new Date()
  const result = prepareBodyEdit({ submission, form, now, answers: input.answers })
  if (!result.ok) {
    return { failed: result.problems.map((problem) => problem.message).join(' ') }
  }

  const { edit, permission, unmapped } = result.prepared
  if (unmapped.length > 0) {
    // The answer is still stored in answersJson, so this is a form definition to fix
    // rather than lost data. Same warning the public submit logs.
    console.warn(
      `[${ErrorIds.SUB_VALIDATION_FAIL}] unmapped registry keys on a portal edit: ${unmapped
        .map((entry) => entry.registryKey)
        .join(', ')}`,
    )
  }

  // `updateSubmission` expires the tags this write affects, so nothing invalidates on top
  // of it here.
  await updateSubmission({ ...edit, submissionId: submission.id, eventId })

  if (permission.alertsAdminsOnSave && form !== undefined) {
    // Enqueued AFTER the write, which is the opposite order to Notify (see decisions.ts)
    // and for the same reason read the other way round: there the email IS the action, so
    // a queued row with no status change is recoverable. Here the save is the action and
    // the alert reports a fact, so telling an organizer about an edit that did not land
    // would send them looking for a version of the abstract that does not exist.
    await enqueueOutbox(
      adminUpdateOutboxRows({
        eventId,
        eventName: event.name,
        eventSlug: event.slug,
        submissionId: submission.id,
        submissionTitle: edit.title,
        submissionCode: submission.code,
        recipients: form.adminAlertOnUpdate,
        editor: editorIdentity(submission, speakerId),
        updatedAt: now.toISOString(),
        linkUrl: `${appUrl()}/admin/${eventId}/abstracts`,
        // The organizer's own body for this alert, when they have written one. Read here
        // rather than in the `Promise.all` above so an event with no admin recipients pays
        // nothing for it, and read through the CACHED, tagged list so an event with forty
        // edits an hour is not forty Airtable round trips (reads-comms.ts).
        template: await findEmailTemplate(eventId, TEMPLATE_KEYS.adminUpdate),
      }),
    )
  }

  return 'Your changes have been saved.'
}

/**
 * Who to name in the alert. Read off the roster the submission already carries rather than
 * with a second `getSpeaker` call, since the acting speaker is on it by definition: that is
 * what `resolveOwnSubmission` just established.
 */
function editorIdentity(
  submission: SubmissionWithParticipants,
  speakerId: RecordId,
): { name: string; email: string } {
  // Ownership is broader than the roster (`speakerOwnsSubmission`), so a submitter who was
  // never added as a participant has no row here. `update-alert` supplies the last resort.
  const speaker = submission.participants.find((row) => row.speakerId === speakerId)?.speaker
  return {
    name: [speaker?.firstName, speaker?.lastName].filter((part) => part !== undefined).join(' '),
    email: speaker?.email ?? '',
  }
}
