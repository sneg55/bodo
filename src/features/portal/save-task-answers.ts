// Saving a task's evidence without completing it: the "save my progress" half of filling in
// a portal form (BUILD_SPEC 5.6), and, since CNT-02, the same idea for an upload task's file.
//
// `saveTaskAnswers` is the missing caller for the DAL function of the same name in
// `@/services/airtable/mutations-portal.ts`, which had existed with no call site until this was
// written. `link` and `confirm` still have nothing partial to save: a ticked box is either ticked
// or it is not, and a Save button on one of them would be a control with no state to preserve.
// `upload` used to be grouped with them on the same reasoning and that was wrong: the file a
// speaker just sent to R2 is exactly the kind of work a reload should not be able to lose, and
// `TaskCompletion.tsx` used to keep it in `useState` alone. `saveTaskUpload` is the second half of
// fixing that (own-assignment.ts and actions.ts's `completeTaskAction` are the rest of the
// account): it persists the `Files` row's id onto the assignment the moment the upload succeeds,
// so `Mark complete` after a reload, or from a different tab entirely, reads the same evidence the
// upload already produced instead of the empty component state a fresh mount starts with.
//
// The order of the first three steps is the security property, and it is the order every other
// portal mutation uses: resolve the acting speaker, load the assignment, check that it belongs to
// that speaker, and only then write. BUILD_SPEC 4: a Server Action is reachable by POST with no
// layout ever rendering, so the page having rendered a Save button authorizes nothing.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import type { FormAnswers } from '@/features/forms/logic'
import { portalEventIds } from '@/features/portal/event-scope'
import { resolveOwnAssignment } from '@/features/portal/own-assignment'
import { portalDataPort } from '@/features/portal/ports'
import { answersToStore, partialAnswerProblems } from '@/features/portal-forms/answers'
import { listForms } from '@/services/airtable/queries'

export type SaveTaskAnswersInput = {
  assignmentId: string
  /** Raw answers as posted, keyed by `FormField.id`. Stripped here, not by the caller. */
  answers: FormAnswers
}

/**
 * Store a form task's answers, or say why not.
 *
 * Returns the message the form renders, matching the `guarded()` contract in ./actions.ts: a
 * string is a success and `{ failed }` is a refusal the speaker can act on.
 *
 * A required question left BLANK is allowed, which is the whole point: a speaker halfway through
 * a long form wants their work kept. A question answered WRONGLY is not, because the completion
 * would refuse the same value later and the speaker would meet that refusal on a form they had
 * been told was saved. `partialAnswerProblems` is exactly that split.
 */
export async function saveTaskAnswers(
  input: SaveTaskAnswersInput,
): Promise<string | { failed: string }> {
  const { speakerId } = await requireSpeaker()

  // Resolved across the speaker's whole event scope, with the ownership check inside the
  // call. It used to list the ONE configured event, so a form task on any other conference
  // answered "no such task assignment" for a row the speaker was looking at. Same defect the
  // completion had, and ./own-assignment.ts is the account of it.
  const { eventId, item } = await resolveOwnAssignment({
    speakerId,
    eventIds: await portalEventIds(speakerId),
    assignmentId: input.assignmentId,
  })

  if (item.task.kind !== 'form') {
    // Not a defensive nicety. `answersJson` on a non-form task is the evidence `buildCompletion`
    // produced (`{ fileId }`, `{ visitConfirmed: true }`, `{ confirmed: true }`), so writing an
    // answer set over it would overwrite the record of what was actually confirmed.
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      'only a form task keeps answers, so there is nothing to save on this one',
      { assignmentId: input.assignmentId, kind: item.task.kind },
    )
  }

  if (item.assignment.status === 'done') {
    // A completed assignment's answers are what the organizer has already read. Overwriting them
    // through a save would change the record without moving the status, so nothing would show
    // that it happened.
    return { failed: 'This task is already complete, so its answers can no longer be changed.' }
  }

  const forms = await listForms(eventId)
  const form = forms.find((candidate) => candidate.id === item.task.formId)
  if (form === undefined) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'this task links a form that no longer exists, so there is nothing to save it against',
      { assignmentId: input.assignmentId, taskId: item.task.id },
    )
  }

  const problems = partialAnswerProblems(form.fields, input.answers)
  if (problems.length > 0) {
    return { failed: problems.map((problem) => problem.message).join(' ') }
  }

  // `saveTaskAnswers` writes `answersJson` and nothing else, and it expires the tags this row sits
  // behind, so nothing invalidates on top of it here.
  await portalDataPort().saveTaskAnswers({
    assignmentId: input.assignmentId,
    answers: answersToStore(form.fields, input.answers),
  })

  return 'Your progress has been saved.'
}

export type SaveTaskUploadInput = {
  assignmentId: string
  /** The `Files` record id the upload route returned, never the R2 object key. */
  fileId: string
}

/**
 * Store an upload task's file id WITHOUT completing it. Filed for CNT-02.
 *
 * `TaskCompletion.tsx` calls this the moment `/api/files/upload` answers 201, before the
 * speaker ever presses `Mark complete`. Until this existed, the only place that id lived was
 * `useState` in that component, so a reload between the upload and the press discarded it: the
 * object was in R2, the `Files` row existed, and `Mark complete` still refused with "no file was
 * uploaded" because nothing server-side remembered which file the upload had just produced.
 *
 * Reuses the DAL's `saveTaskAnswers` write and not a new one, for the same reason
 * `buildCompletion` shapes a completed upload's evidence as `{ fileId }`: one column holds
 * whatever a task's evidence is, whichever kind produced it, and `completeTaskAction` reads this
 * back through that same shape when the speaker's next post carries no file of its own.
 */
export async function saveTaskUpload(
  input: SaveTaskUploadInput,
): Promise<string | { failed: string }> {
  const { speakerId } = await requireSpeaker()

  const { item } = await resolveOwnAssignment({
    speakerId,
    eventIds: await portalEventIds(speakerId),
    assignmentId: input.assignmentId,
  })

  if (item.task.kind !== 'upload') {
    throw new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      'only an upload task keeps a pending file this way',
      { assignmentId: input.assignmentId, kind: item.task.kind },
    )
  }

  if (item.assignment.status === 'done') {
    // Matches `saveTaskAnswers`: a completed assignment's evidence is what the organizer has
    // already read, so a later upload on the same row must not rewrite it quietly.
    return { failed: 'This task is already complete, so its file can no longer be changed.' }
  }

  const fileId = input.fileId.trim()
  if (fileId === '') {
    throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'fileId is required', {
      assignmentId: input.assignmentId,
    })
  }

  await portalDataPort().saveTaskAnswers({
    assignmentId: input.assignmentId,
    answers: { fileId },
  })

  return 'File recorded.'
}
