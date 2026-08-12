// Correcting a submission whose stored track was written before the CFP-06/CFP-15
// precedence fix landed. The write that fix touches (`prepareSubmission`, `prepareDraft`)
// only ever runs at creation, and accepting a submission never re-derived its track -
// `commitStatus` was a status flip, nothing more - so a record filed while routing still
// outranked an answered Track question kept that wrong track forever unless something
// rewrote it. Two callers now do:
//
//   - `commitStatus` (`commit-status.ts`) applies it automatically the moment a submission
//     becomes `accepted`, since that is the one write that turns a submission into a
//     session and the first point the agenda and the public site start reading its track.
//   - `repairSubmissionTrackAction` (`track-repair-action.ts`) is for every row accepted
//     BEFORE that wiring existed: those already passed through the accept transition once
//     and will not pass through it again, so nothing rewrites them without an explicit,
//     organizer-visible control. That control lives on the submission detail page
//     (`SubmissionDecisionActions.tsx`), stating the track it would apply rather than
//     acting as a bare button.
//
// Deliberately NOT a `'use server'` file, and that is not incidental: `previewTrackFix`
// below is synchronous, and a `'use server'` module may only export async functions
// (`action-result.ts` states the same rule for the same reason). Splitting it out here
// also keeps `commit-status.ts`'s import graph free of `requireEventRole` and everything
// under it - `commitStatus` never authorizes anything itself, callers already have, and
// pulling an auth-checking action into a status-write module only because they share a
// computation would be the wrong coupling.

import { splitAnswers } from '@/features/forms/answer-storage'
import { sanitizeAnswers } from '@/features/forms/logic'
import { submissionColumnValues } from '@/features/submissions/columns'
import { staleTrackId } from '@/features/submissions/track-precedence'
import { updateSubmission } from '@/services/airtable/mutations-content'
import type { RecordId, Submission } from '@/types/domain'
import type { Form } from '@/types/forms'

/** What the computation and the write each need off a submission. Any loaded row satisfies it. */
export type TrackRepairSubject = Pick<
  Submission,
  | 'id'
  | 'formId'
  | 'answers'
  | 'title'
  | 'format'
  | 'level'
  | 'language'
  | 'ceuCredits'
  | 'trackId'
  | 'tagIds'
>

/**
 * The corrected track, or `undefined` when the record needs nothing: `staleTrackId` finds
 * nothing to fix, or agrees with what is already stored. Pure - performs no write - so a
 * page can call it to decide whether to show a control at all, not only an action to apply
 * one.
 *
 * Runs the SAME pipeline `prepareSubmission` does, over the submission's STORED answers
 * rather than a fresh payload: sanitize against the form's CURRENT fields (a field the
 * builder later hid must not resurrect an answer to it), then split, then narrow.
 */
export function previewTrackFix(
  submission: TrackRepairSubject,
  form: Pick<Form, 'fields' | 'routing'>,
): RecordId | undefined {
  const answers = sanitizeAnswers(form.fields, submission.answers)
  const split = splitAnswers(form.fields, answers)
  const columns = submissionColumnValues(split.columns)

  return staleTrackId({
    routing: form.routing,
    fields: form.fields,
    answers,
    columns,
    storedTrackId: submission.trackId,
  })
}

/**
 * `previewTrackFix`, written if it finds anything.
 *
 * The whole record is echoed back to `updateSubmission` unchanged apart from the one
 * column being fixed, because that write replaces `answersJson` and every typed column at
 * once (`SubmissionEdit`'s own header): a caller that sent only `trackId` would clear the
 * rest. `updateSubmission` is also what satisfies the caching rule here - it expires the
 * submission's own tags and the agenda tag itself, so neither caller needs its own
 * `invalidate()` call.
 */
export async function applyTrackFix(
  eventId: RecordId,
  submission: TrackRepairSubject,
  form: Pick<Form, 'fields' | 'routing'>,
): Promise<RecordId | undefined> {
  const corrected = previewTrackFix(submission, form)
  if (corrected === undefined) return undefined

  await updateSubmission({
    submissionId: submission.id,
    eventId,
    title: submission.title,
    answers: submission.answers,
    format: submission.format,
    level: submission.level,
    language: submission.language,
    ceuCredits: submission.ceuCredits,
    trackId: corrected,
    tagIds: submission.tagIds,
  })

  return corrected
}
