// The SPEAKER branch of POST /api/files/upload.
//
// Split out of route.ts when the portal stopped being single-event and this branch grew the
// step that resolves an upload's event from the submission it names. The route now holds the
// three-way authorization decision and the error mapping; everything a speaker-owned upload
// does after `requireSpeaker()` lives here.
//
// The ordering below is the part worth preserving, and every step of it is a rule rather
// than a preference:
//
//   1. Ownership is resolved BEFORE the upload, so a file is never stored against a
//      submission the caller turns out not to own. The reverse order leaves an orphan object
//      in R2 on every refused attempt.
//   2. The file request assignment is resolved and refused before the upload too, for the
//      same reason.
//   3. The Files row is written AFTER the object is stored and HEADed, never before: a row
//      pointing at an object that does not exist is worse than no row, because the portal
//      renders it as a file the speaker can open.
//   4. The receipt is written AFTER the Files row. The row is the evidence, and a receipt
//      written first would leave a request reading "received" with nothing to point at if
//      the write that follows it failed.

import { AppError, type ErrorId, ErrorIds } from '@/constants/errorIds'
import {
  plannedReceipt,
  type RequestTarget,
  type RequestTargetProblem,
  resolveRequestTarget,
} from '@/features/file-requests/receipt'
import { portalEventId } from '@/features/portal/event-scope'
import { resolveOwnSubmission } from '@/features/portal/resolve-submission'
import { createFileRecord } from '@/services/airtable/mutations-portal'
import { setFileRequestReceipt } from '@/services/airtable/mutations-requests'
import { saveSpeakerProfile } from '@/services/airtable/mutations-speakers'
import { getSpeaker } from '@/services/airtable/queries'
import { listFileRequestAssignmentsUncached } from '@/services/airtable/reads-requests'
import { publicUrlFor, putObject, type UploadKind } from '@/services/storage/uploads'

/**
 * The kinds this branch handles, which are exactly the speaker-owned ones. It is narrower
 * than `UploadKind` on purpose: those three are also the `Files.kind` select's options, so
 * the type is what stops an event image reaching `createFileRecord`, where the row would need
 * a Speaker link it does not have.
 */
export const KINDS = ['headshot', 'image', 'slides', 'doc'] as const satisfies readonly UploadKind[]
export type SpeakerUploadKind = (typeof KINDS)[number]

export type SpeakerUploadInput = {
  speakerId: string
  kind: SpeakerUploadKind
  /** The user-facing `SESS-<n>`, so nothing has to trust a record id from the client. */
  code: string | null
  fileRequestId: string | null
  filename: string
  contentType: string
  declaredBytes: number
  body: ReadableStream<Uint8Array>
}

export async function storeSpeakerUpload(input: SpeakerUploadInput): Promise<Response> {
  const { speakerId, kind, filename, contentType, declaredBytes, body } = input

  const code = input.code?.trim()
  const owned =
    code === undefined || code === '' ? undefined : await resolveOwnSubmission({ speakerId, code })

  // The SUBMISSION'S event when there is one, and only otherwise the configured default.
  // A file uploaded against a session at any other conference used to be linked to, and
  // invalidated for, `PORTAL_EVENT_ID`; now that the portal spans events that is a file
  // filed under the wrong conference rather than a merely redundant lookup.
  const eventId = owned?.eventId ?? portalEventId()

  const assignment = await openAssignment({
    requested: input.fileRequestId,
    eventId,
    speakerId,
    submissionId: owned?.id,
  })

  const stored = await putObject(
    { kind, speakerId, filename, contentType, declaredBytes, body },
    crypto.randomUUID(),
  )

  if (kind === 'headshot') {
    // The headshot is the one kind whose location also lives on the Speakers record,
    // because that is where every read of an avatar looks. The `'route'` origin is still
    // passed because the DAL's write signature takes it, but it no longer selects
    // between two invalidation APIs: `revalidateTag` is the only one, and it works here
    // exactly as it does in a Server Action.
    const speaker = await getSpeaker(speakerId)
    await saveSpeakerProfile(
      {
        speakerId,
        eventId,
        draft: { email: speaker.email, headshotUrl: publicUrlFor(stored.objectKey, 'public') },
      },
      'route',
    )
  }

  const file = await createFileRecord(
    {
      speakerId,
      submissionId: owned?.id,
      // The link that makes the file live ON the request, which is the whole distinction ref
      // 31's callout draws: the row is what a `FileRequestAssignments` receipt points back to.
      fileRequestAssignmentId: assignmentIdOf(assignment),
      kind,
      objectKey: stored.objectKey,
      visibility: stored.visibility,
      contentType: stored.contentType,
      filename,
      size: stored.size,
      // The HEAD in `putObject` already confirmed the stored size and type match what
      // was declared, so the row is verified at the moment it is written.
      uploadedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
    },
    'route',
    // Not stored on the row: it is what expires `event:{id}:files`, the tag the two admin
    // Files lists read under. No Files row records an event, so nothing downstream could
    // work it out afterwards.
    eventId,
  )

  // `plannedReceipt` returns nothing when the row is already received, so a second upload
  // against one request stores the file and does not move the stamp.
  const receipt =
    assignment === undefined ? undefined : plannedReceipt(assignment, new Date().toISOString())
  if (receipt !== undefined) {
    await setFileRequestReceipt({ ...receipt, eventId }, 'route')
  }

  return Response.json(
    {
      fileId: file.id,
      objectKey: stored.objectKey,
      size: stored.size,
      contentType: stored.contentType,
      visibility: stored.visibility,
      submissionId: owned?.id,
      fileRequestAssignmentId: assignmentIdOf(assignment),
    },
    { status: 201 },
  )
}

/**
 * The caller's own open assignment for the file request they named, or `undefined` when they
 * named none.
 *
 * Its own function because it is the whole authorization story for a file request upload: the
 * read is scoped to the acting speaker, so a request id belonging to somebody else's
 * assignment is simply not in the set and comes back refused. The read is UNCACHED, because
 * its answer decides a write (reads-requests.ts).
 */
async function openAssignment(input: {
  requested: string | null
  eventId: string
  speakerId: string
  submissionId?: string
}): Promise<RequestTarget | undefined> {
  const fileRequestId = input.requested?.trim()
  if (fileRequestId === undefined || fileRequestId === '') return undefined

  const target = resolveRequestTarget({
    items: await listFileRequestAssignmentsUncached(input.eventId, input.speakerId),
    fileRequestId,
    submissionId: input.submissionId,
  })

  if (!target.ok) {
    throw new AppError(problemErrorId(target.problem), target.message, {
      fileRequestId,
      problem: target.problem,
    })
  }
  return target
}

/** The resolved row's id, for the `Files` link. `undefined` when no request was named. */
function assignmentIdOf(target: RequestTarget | undefined): string | undefined {
  return target?.ok === true ? target.item.assignment.id : undefined
}

/**
 * Why the request was refused, as an error id.
 *
 * `not-requested` is a missing record and `wrong-submission` is a request for a session it was
 * not opened for; both are 400 through the route's `statusFor`, and they are distinguished so
 * the log line says which of the two happened rather than making it guessable from the text.
 */
function problemErrorId(problem: RequestTargetProblem): ErrorId {
  return problem === 'ambiguous-submission'
    ? ErrorIds.SUB_VALIDATION_FAIL
    : ErrorIds.DATA_RECORD_NOT_FOUND
}
