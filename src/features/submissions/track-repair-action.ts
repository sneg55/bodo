'use server'

// The organizer-facing control's write: reconcile ONE already-accepted submission's track
// by id. `track-repair.ts` carries the computation (`previewTrackFix`/`applyTrackFix`) and
// the reasoning for why it exists at all; this is just that computation behind an
// authorized Server Action, for the submission detail page's button
// (`SubmissionDecisionActions.tsx`).
//
// Split from `track-repair.ts` on purpose, not by file-size. A `'use server'` module may
// only export async functions, and `previewTrackFix` is synchronous (`action-result.ts`
// states the same rule for the same reason); keeping this action here also stops
// `requireEventRole` and everything under it from entering `commit-status.ts`'s import
// graph, which never authorizes anything itself.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { applyTrackFix } from '@/features/submissions/track-repair'
import { getSubmission, listForms } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

export type RepairTrackInput = {
  eventId: RecordId
  submissionId: RecordId
}

export type RepairTrackOutcome = {
  /** `false` when the record needed nothing: no form, no answered Track question, or the
   *  stored value already agrees with it. */
  corrected: boolean
  trackId?: RecordId
}

/**
 * `SubmissionDecisionActions.tsx` only renders the button when `previewTrackFix` already
 * found something to apply, so the common case here is a single write; a `corrected:
 * false` result means the record changed between the page load and the click (an
 * organizer opened two tabs, or ran this twice), not an error.
 */
export async function repairSubmissionTrackAction(
  input: RepairTrackInput,
): Promise<ActionResult<RepairTrackOutcome>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Re-checked against the record for the same reason `roster-admin.ts` checks it: a
    // submission id is a path segment and a Server Action argument, so an admin of one
    // event must not be able to touch another's row by pasting its id.
    const submission = await getSubmission(input.submissionId)
    if (submission.eventId !== input.eventId) {
      throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'That submission is not on this event.', {
        submissionId: input.submissionId,
        eventId: input.eventId,
      })
    }

    // No form, no submitted answer to have lost: a manual entry (`manual-abstract.ts`)
    // never asked a Track question, so its stored track, whatever it is, is the whole
    // record of the organizer's choice and nothing here second-guesses it.
    if (submission.formId === undefined) return actionOk({ corrected: false })

    const forms = await listForms(input.eventId)
    const form = forms.find((candidate) => candidate.id === submission.formId)
    if (form === undefined) return actionOk({ corrected: false })

    const corrected = await applyTrackFix(input.eventId, submission, form)
    return actionOk({ corrected: corrected !== undefined, trackId: corrected })
  } catch (error) {
    return actionFailure(error)
  }
}
