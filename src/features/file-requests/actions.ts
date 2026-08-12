'use server'

// The admin half of File Requests: define one, and assign it to the accepted speakers.
//
// Both authorize for themselves with `requireEventRole(eventId, 'admin')`, and not because the
// layout fails to redirect: a Server Action is reachable by POST without any layout ever
// rendering (BUILD_SPEC 4). `reviewer` is refused deliberately. Holding a review role on an
// event is not permission to demand a document from a speaker.
//
// Nothing here decides anything. The scope comes from `acceptedSpeakerScopes` (shared with
// tasks: being accepted is the same fact for both) and the rows from `planRequestAssignments`,
// both pure and both unit tested, so the parts that are expensive to debug through a form post
// are asserted directly.
//
// CREATING NOW ASSIGNS, when the drawer's switch is on, which it is by default. Creating used
// to define a request and stop: the card read "Not requested from anybody yet", no portal ever
// showed it, and nothing said so, so the only signal that a request was collecting nothing
// looked exactly like a request nobody had answered yet.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { eventInstant } from '@/features/events/due-date'
import { planRequestAssignments } from '@/features/file-requests/plan'
import {
  type CreateFileRequestInput,
  isRequestDraftValid,
  REQUEST_TITLE_MAX,
} from '@/features/file-requests/request-draft'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import {
  createFileRequest,
  createFileRequestAssignments,
} from '@/services/airtable/mutations-requests'
import {
  getEvent,
  listFileRequestAssignmentsForEvent,
  listFileRequests,
  listSubmissions,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'

export type RequestAssignOutcome = { created: number; skipped: number; speakers: number }

export async function createFileRequestAction(
  input: CreateFileRequestInput,
): Promise<ActionResult<{ fileRequestId: RecordId; assigned?: RequestAssignOutcome }>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    // Re-derived server side rather than trusted from the drawer's disabled button, which is
    // a courtesy to a person and not a check on a POST.
    const valid = isRequestDraftValid({
      title: input.title,
      entityType: input.entityType,
      instructionsHtml: input.instructionsHtml ?? '',
      required: input.required,
      dueAt: input.dueAt ?? '',
      requestFromAccepted: input.assign,
    })
    if (!valid) {
      throw new AppError(
        ErrorIds.SUB_VALIDATION_FAIL,
        `a file request needs a title of up to ${REQUEST_TITLE_MAX} characters`,
        { title: input.title },
      )
    }

    const event = await getEvent(input.eventId)
    const request = await createFileRequest({
      eventId: input.eventId,
      title: input.title,
      entityType: input.entityType,
      instructionsHtml: input.instructionsHtml,
      required: input.required,
      // Named field by field rather than spread, now that the input carries `assign`, which
      // is an instruction to this action and not a column on the row.
      //
      // A wall-clock deadline in the EVENT's zone. The drawer emits a zone-less
      // `datetime-local` value and the column is a UTC date-time, while `formatDue` reads it
      // back in the event's zone, so passing the text through put the two out by the offset
      // and an early-morning deadline came out on the previous date. Third time this bug has
      // appeared, after the form builder's close date and the task due date, all found by
      // Codex review and all fixed the same way.
      dueAt: eventInstant(input.dueAt, event.timezone),
      // Stamped here rather than in the field builder, so the row records when an organizer
      // asked for the document and not when some later read happened to map it.
      createdAt: new Date().toISOString(),
    })

    if (!input.assign) return actionOk({ fileRequestId: request.id })

    // Fanned out in the SAME save, out of the record just written rather than by re-reading
    // the event's requests: `createFileRequest` expired that tag a line ago, and a read
    // racing its own invalidation is the one way this could silently assign nothing, which
    // is precisely the failure being fixed.
    const assigned = await fanOutToAcceptedSpeakers(input.eventId, [request])
    return actionOk({ fileRequestId: request.id, assigned })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Fan the named requests out to every accepted speaker.
 *
 * Bulk by construction, the same shape `assignTasksAction` has, because an organizer collects
 * a release form from the whole cast rather than one person at a time. Re-running it is a
 * no-op, since `planRequestAssignments` skips a tuple that already has a row.
 */
export async function assignFileRequestsAction(input: {
  eventId: RecordId
  fileRequestIds: readonly RecordId[]
}): Promise<ActionResult<RequestAssignOutcome>> {
  try {
    await requireEventRole(input.eventId, 'admin')

    const [defined, submissions, existing] = await Promise.all([
      listFileRequests(input.eventId),
      listSubmissions(input.eventId),
      listFileRequestAssignmentsForEvent(input.eventId),
    ])

    // Filtered against the event's own requests, so an id from another event, or a stale one
    // from a list rendered before a delete, cannot be assigned here.
    const requests = defined.filter((request) => input.fileRequestIds.includes(request.id))
    if (requests.length === 0) {
      throw new AppError(
        ErrorIds.DATA_RECORD_NOT_FOUND,
        'no file request on this event was selected',
        { eventId: input.eventId, requested: input.fileRequestIds.length },
      )
    }

    return actionOk(await fanOut(input.eventId, requests, submissions, existing))
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The same fan-out the Assign control runs, for a request that has just been created.
 *
 * Separate from the action above only because that one resolves ids against a cached list
 * and this one already holds the record. Both end in `planRequestAssignments`, so "create
 * and request" and "request later" cannot drift into two different notions of who is
 * accepted.
 */
async function fanOutToAcceptedSpeakers(
  eventId: RecordId,
  requests: readonly FileRequest[],
): Promise<RequestAssignOutcome> {
  const [submissions, existing] = await Promise.all([
    listSubmissions(eventId),
    listFileRequestAssignmentsForEvent(eventId),
  ])
  return await fanOut(eventId, requests, submissions, existing)
}

async function fanOut(
  eventId: RecordId,
  requests: readonly FileRequest[],
  submissions: Awaited<ReturnType<typeof listSubmissions>>,
  existing: Awaited<ReturnType<typeof listFileRequestAssignmentsForEvent>>,
): Promise<RequestAssignOutcome> {
  const scopes = acceptedSpeakerScopes(submissions)
  const plan = planRequestAssignments({
    requests,
    scopes,
    existing: existing.map((item) => item.assignment),
  })

  const created = await createFileRequestAssignments({ eventId, rows: plan.create })
  return { created, skipped: plan.skipped, speakers: scopes.length }
}
