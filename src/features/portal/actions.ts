'use server'

// Every portal mutation, and every one of them authorizes for itself.
//
// The pattern is the same four steps each time, in this order, because the order is
// the security property: resolve the acting speaker with `requireSpeaker()`, load the
// record INSIDE that speaker's own event scope, check that the record belongs to them
// with the guards in ./authorize, and only then write. The layout guard above these is a
// redirect for a browser, not a boundary: a Server Action is reachable by POST without any
// layout rendering, so skipping step three would let one speaker withdraw another's
// submission by posting a different code (BUILD_SPEC 4).
//
// Steps two and three are one call now, because keeping them apart is how they came
// apart: `resolveOwnSubmission` for anything addressed by code and `resolveOwnAssignment`
// for anything addressed by assignment id. Both take the speaker's scope from
// `portalEventIds`, which is an authorization boundary rather than a filter, and both run
// the ./authorize guard on whatever matched. Nothing here reads `portalEventId()`: that is
// configuration, it names one event, and reading it in place of the speaker's scope is
// exactly what broke `Mark complete` (./own-assignment.ts has the account of it).
//
// Invalidation goes through `invalidate()`, which is the DAL's one wrapper over
// `revalidateTag`. There is no longer an action-versus-route distinction to get wrong:
// with Cache Components off the cache entries are the Airtable client's tagged fetches,
// and expiring a tag is the same call wherever the write is running.
//
// THE DATA PORT IS INSTALLED HERE, at module scope, and that is load-bearing rather than
// tidy. `installPortalData()` sets a module-level variable, and the only other caller is
// `(portal)/portal/layout.tsx`. A Server Action is a POST that renders no layout, so in an
// isolate that had not already served a portal PAGE the port was still `unprovisioned`,
// whose `listTaskAssignments` returns `[]` without going near Airtable. Every `Mark
// complete` in that isolate then answered "no such task assignment" for a row the speaker
// was plainly looking at, and the same click in a warm isolate worked, which is why two eval
// agents on the same build reported opposite results. Confirmed on the deployed Worker with
// `wrangler tail`: the failing POST fetched the Speakers record and made no Tasks or
// TaskAssignments request at all.
//
// Module scope rather than a call inside each action, because an action cannot run without
// its module being loaded, and `installPortalData` is idempotent. The project rule this
// broke is the Workers one: module-level mutable state does not survive, and nothing may
// assume another request already set it up.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import {
  type ActionResult,
  completionInput,
  guarded,
  postedStrings,
  required,
  withStoredFileFallback,
} from '@/features/portal/actions-support'
import { portalEventIds, speakerHomeEventId } from '@/features/portal/event-scope'
import { resolveOwnAssignment } from '@/features/portal/own-assignment'
import { portalDataPort } from '@/features/portal/ports'
import { profileDraftFrom } from '@/features/portal/profile-form'
import { resolveOwnSubmission } from '@/features/portal/resolve-submission'
import { saveSubmissionBody } from '@/features/portal/save-body'
import { saveTaskAnswers, saveTaskUpload } from '@/features/portal/save-task-answers'
import { parsePostedAnswers } from '@/features/portal/submission-edit'
import { buildCompletion } from '@/features/portal/task-completion'
import { installPortalData } from '@/features/portal/wiring'
import { commitStatus } from '@/features/submissions/commit-status'
import { announceTaskCompleted } from '@/features/webhooks/announce'
import { invalidate } from '@/services/airtable/invalidate'
import { saveSpeakerProfile } from '@/services/airtable/mutations-speakers'
import { getSpeaker, listForms, listSubmissions } from '@/services/airtable/queries'
import {
  eventSubmissionsTag,
  eventTasksTag,
  speakerTag,
  speakerTasksTag,
  submissionTag,
} from '@/services/airtable/tags'
import type { SubmissionWithParticipants } from '@/types/domain'

export type { ActionResult } from '@/features/portal/actions-support'

// See the header. An action can be the first thing an isolate runs, so it cannot rely on a
// portal page render having wired the port.
installPortalData()

export async function saveProfileAction(formData: FormData): Promise<ActionResult> {
  return await guarded(async () => {
    const { speakerId } = await requireSpeaker()
    const speaker = await getSpeaker(speakerId)

    // The email comes from the stored record, never from the posted form: it is the
    // identity magic-link login keys on. The stored links come from it for a different
    // reason: they share one JSON column, so a link the form did not post is filled from
    // the record rather than blanked (see `profileDraftFrom`).
    const draft = profileDraftFrom(postedStrings(formData), speaker.email, speaker.links)
    // The speaker's OWN event, not the configured one: this write's `eventId` only seeds the
    // tags it expires, and naming a conference the speaker may not be in expired caches
    // nobody was reading while leaving their own admin lists stale. See `speakerHomeEventId`.
    await saveSpeakerProfile({ speakerId, eventId: await speakerHomeEventId(speakerId), draft })

    return 'Your changes have been saved.'
  })
}

/**
 * The submission-body edit (BUILD_SPEC 5.2). Everything it does is in ./save-body.ts,
 * including the ownership check and the server-side re-derivation of the edit policy.
 */
export async function saveSubmissionBodyAction(formData: FormData): Promise<ActionResult> {
  return await guarded(
    async () =>
      await saveSubmissionBody({
        code: required(formData, 'code'),
        answers: parsePostedAnswers(required(formData, 'answers')),
      }),
  )
}

export async function submitDraftAction(formData: FormData): Promise<ActionResult> {
  return await guarded(async () => {
    const { speakerId, submission } = await ownedSubmission(formData)

    if (submission.status !== 'draft') {
      throw new AppError(ErrorIds.SUB_ILLEGAL_TRANSITION, 'only a draft can be submitted', {
        status: submission.status,
      })
    }

    // `commitStatus`, not `setSubmissionStatus`: a draft going for review is a state change
    // the organizer's channel wants, and fusing the two writes is what stops this path from
    // being the one that forgets. See features/submissions/commit-status.ts.
    await commitStatus(submission.eventId, submission, 'pending')
    invalidate('action', { own: [speakerTag(speakerId)] })

    return 'Your submission has been sent for review.'
  })
}

export async function withdrawSubmissionAction(formData: FormData): Promise<ActionResult> {
  return await guarded(async () => {
    const { speakerId, submission } = await ownedSubmission(formData)

    // Withdrawing an accepted session is the organizer's problem to hear about first,
    // not a self-service action: it takes a slot off the agenda they have published.
    if (submission.status !== 'draft' && submission.status !== 'pending') {
      throw new AppError(
        ErrorIds.SUB_ILLEGAL_TRANSITION,
        'this submission can no longer be withdrawn here: contact the organizer',
        { status: submission.status },
      )
    }

    await commitStatus(submission.eventId, submission, 'withdrawn')
    invalidate('action', { own: [speakerTag(speakerId)] })

    return 'Your submission has been withdrawn.'
  })
}

/**
 * Save a form task's answers without completing it. Everything it does is in
 * ./save-task-answers.ts, including the ownership check and the partial-validation rule, and this
 * wrapper exists only to pull the two values out of a FormData.
 */
export async function saveTaskAnswersAction(formData: FormData): Promise<ActionResult> {
  return await guarded(
    async () =>
      await saveTaskAnswers({
        assignmentId: required(formData, 'assignmentId'),
        answers: parsePostedAnswers(required(formData, 'answers')),
      }),
  )
}

/**
 * Persist an upload task's file id without completing it. Everything it does is in
 * ./save-task-answers.ts (`saveTaskUpload`), including the ownership check; this wrapper only
 * pulls `assignmentId` and `fileId` out of the FormData `TaskCompletion.tsx` posts the moment
 * `/api/files/upload` answers 201, before the speaker has pressed `Mark complete`. See CNT-02.
 */
export async function saveTaskUploadAction(formData: FormData): Promise<ActionResult> {
  return await guarded(
    async () =>
      await saveTaskUpload({
        assignmentId: required(formData, 'assignmentId'),
        fileId: required(formData, 'fileId'),
      }),
  )
}

export async function completeTaskAction(formData: FormData): Promise<ActionResult> {
  return await guarded(async () => {
    const { speakerId } = await requireSpeaker()
    const assignmentId = required(formData, 'assignmentId')

    // ACROSS THE SPEAKER'S EVENTS, and the ownership check is inside this call. Listing one
    // configured event here is what broke `Mark complete` for every speaker whose task hung
    // off any other conference: the row was on the page and the write said it did not exist.
    // ./own-assignment.ts has the whole account of it.
    const { eventId, item } = await resolveOwnAssignment({
      speakerId,
      eventIds: await portalEventIds(speakerId),
      assignmentId,
    })

    // Already done is refused rather than re-recorded. Completion evidence is a record of what
    // was submitted and when, and a repeat post with different answers silently rewrote both
    // `answersJson` and `completedAt`. `saveTaskAnswers` already drew this line; this is the
    // other half of it. Found by Codex review.
    if (item.assignment.status === 'done') {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, 'that task is already complete', {
        assignmentId,
      })
    }

    const forms = await listForms(eventId)
    // Falls back to the assignment's own already-saved fileId when this post carries none,
    // for CNT-02: a page reload wipes `TaskCompletion.tsx`'s component state, and `Mark
    // complete` used to refuse a task whose file was already attached because the empty
    // client state was all `buildCompletion` was ever shown. See ./actions-support.ts.
    const submitted = withStoredFileFallback(item, completionInput(formData))
    const { answers, problems } = buildCompletion({
      task: item.task,
      form: forms.find((candidate) => candidate.id === item.task.formId),
      submitted,
    })
    if (problems.length > 0) {
      return { failed: problems.map((problem) => problem.message).join(' ') }
    }

    await portalDataPort().completeTaskAssignment({
      assignmentId,
      completedAt: new Date().toISOString(),
      answers,
    })

    // After the write, and it cannot fail it: `announceTaskCompleted` swallows its own
    // errors. This is the only path in the product that completes a task, impersonation
    // included, so it is the whole producer for `task.completed`.
    await announceTaskCompleted(eventId, assignmentId, item.task, speakerId)

    // The speaker's own portal, the submission the task hangs off, and the admin's
    // list, which shows task progress per submission.
    //
    // `eventId` is the event the assignment was RESOLVED under, so a completion on the
    // speaker's second conference expires that conference's list and not the configured
    // one's. Naming the configured event here left the organizer who owns the task looking
    // at a stale board while a conference the speaker may not even be in lost its cache.
    //
    // The two task tags are named here as well as by the DAL write underneath
    // (`setTaskAssignmentStatus`), on purpose: they are what /portal/tasks and the admin
    // board actually read, and this action must not depend on which port is installed to
    // expire the list it just changed. Expiring an already-expired tag costs nothing.
    invalidate('action', {
      own: [
        speakerTag(speakerId),
        speakerTasksTag(speakerId),
        eventTasksTag(eventId),
        ...(item.assignment.submissionId === undefined
          ? []
          : [submissionTag(item.assignment.submissionId)]),
        eventSubmissionsTag(eventId),
      ],
    })

    return 'Task completed.'
  })
}

/**
 * Load the submission named by the form and refuse unless it belongs to the caller.
 *
 * The resolution itself lives in ./resolve-submission.ts because the upload route needs
 * the identical check, and this wrapper exists only to pull `code` out of a FormData.
 */
async function ownedSubmission(
  formData: FormData,
): Promise<{ speakerId: string; submission: SubmissionWithParticipants }> {
  const { speakerId } = await requireSpeaker()
  const submission = await resolveOwnSubmission({
    speakerId,
    code: required(formData, 'code'),
  })

  return { speakerId, submission }
}
