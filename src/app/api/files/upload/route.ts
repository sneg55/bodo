// POST /api/files/upload: the one upload path, streaming through the Worker.
//
// BUILD_SPEC 5.2 decides the design and `@/services/storage/uploads` implements it:
// validate the declared content type and size before the first byte is written,
// `bucket.put(key, request.body)` so nothing is buffered, then HEAD the object and
// return only if the stored size and type match what was declared.
//
// A route handler rather than a Server Action, because a Server Action receives the
// body already buffered into a FormData, which is the one thing a 25 MB upload on a
// Worker must not do.
//
// It authorizes for itself, in THREE branches, because there are three ways to own an upload.
// A speaker upload goes through `requireSpeaker()` and is keyed under the resolved speaker id,
// so a speaker cannot write into another speaker's prefix by asking to. An EVENT image has no
// speaker at all, so it goes through `requireEventRole(eventId, 'admin')` and is keyed under
// the resolved event id. An organizer replacing a SPEAKER's headshot from the admin roster is
// authorized on the event, keyed under the speaker, and its speaker id is resolved against
// that event's own roster before a byte moves. The two organizer branches live in
// src/features/settings/event-image-upload.ts and src/features/speakers/headshot-upload.ts,
// where their properties are written out. Both are decided and returned BEFORE
// `requireSpeaker()` and neither weakens it: any other kind still needs a speaker session.
//
// A Files row is written for every kind, after the object is stored and HEADed, never
// before: a row pointing at an object that does not exist is worse than no row, because
// the portal renders it as a file the speaker can open.
//
// An optional `code` attaches the file to one of the caller's own submissions. It is the
// user-facing `SESS-<n>` code rather than a record id, so nothing has to trust an id
// supplied by the client, and it resolves through `resolveOwnSubmission`, which is the
// same ownership check the portal mutations use.
//
// An optional `fileRequestId` answers one of the caller's own File Requests. The row it
// satisfies is chosen by `resolveRequestTarget` (pure, unit tested) out of a speaker-scoped
// read, so a request id belonging to somebody else's assignment resolves to nothing and is
// refused BEFORE any bytes are stored. The `Files` row then links the assignment, and the
// assignment moves to received, in that order.
//
// One honest limitation, loud rather than papered over: with no `BODO_UPLOADS` binding,
// `getUploadBucket()` raises CFG_BINDING_MISSING and this returns 503. There is
// deliberately no in-memory fallback, because an upload that reports success and stores
// nothing loses the file.

import {
  KINDS,
  type SpeakerUploadKind,
  storeSpeakerUpload,
} from '@/app/api/files/upload/speaker-upload'
import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireSpeaker } from '@/features/auth/wiring'
import { uploadEventImage } from '@/features/settings/event-image-upload'
import { eventImageKindOf } from '@/features/settings/event-images'
import { SPEAKER_HEADSHOT_KIND, uploadSpeakerHeadshot } from '@/features/speakers/headshot-upload'

export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request)
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json({ error: error.message, id: error.id }, { status: statusFor(error.id) })
    }
    // Logged before rethrowing, because the alternative is what actually happened while this
    // route was being extended: R2 rejected the body with a plain `TypeError`, the handler
    // rethrew, and the only trace of it was a bare 500 with an empty body. An unexpected
    // failure here loses a speaker's file, so it is worth a line.
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] unhandled upload failure`,
      error instanceof Error ? error.stack : String(error),
    )
    throw error
  }
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const filename = (url.searchParams.get('filename') ?? 'upload').trim()
  const contentType = request.headers.get('content-type') ?? ''
  const declaredBytes = Number(request.headers.get('content-length') ?? Number.NaN)
  const body = request.body

  if (body === null) {
    throw new AppError(ErrorIds.FILE_UPLOAD_FAIL, 'the request had no body to store')
  }

  // The ORGANIZER branch, and the reason it is a branch at all: an event logo has no speaker,
  // so `requireSpeaker()` below cannot authorize it. `uploadEventImage` authorizes with
  // `requireEventRole(eventId, 'admin')` as its first act, keys the object under that
  // resolved event id, and writes the URL onto the event once the bytes are verified. See
  // src/features/settings/event-image-upload.ts for the four properties it holds.
  const eventImageKind = eventImageKindOf(url.searchParams.get('kind'))
  if (eventImageKind !== undefined) {
    const image = await uploadEventImage({
      kind: eventImageKind,
      eventId: searchValue(url, 'eventId'),
      filename,
      contentType,
      declaredBytes,
      body,
    })
    return Response.json(image, { status: 201 })
  }

  // The second ORGANIZER branch: a speaker's headshot from the admin roster, authorized on the
  // named event and resolved against that event's own roster, so the speaker id on the query
  // string is a request and not a grant. See src/features/speakers/headshot-upload.ts.
  if (searchValue(url, 'kind') === SPEAKER_HEADSHOT_KIND) {
    const headshot = await uploadSpeakerHeadshot({
      eventId: searchValue(url, 'eventId'),
      speakerId: searchValue(url, 'speakerId'),
      filename,
      contentType,
      declaredBytes,
      body,
    })
    return Response.json(headshot, { status: 201 })
  }

  const { speakerId } = await requireSpeaker()

  return await storeSpeakerUpload({
    speakerId,
    kind: readKind(url.searchParams.get('kind')),
    code: url.searchParams.get('code'),
    fileRequestId: url.searchParams.get('fileRequestId'),
    filename,
    contentType,
    declaredBytes,
    body,
  })
}

function readKind(value: string | null): SpeakerUploadKind {
  const found = KINDS.find((candidate) => candidate === value)
  if (found === undefined) {
    throw new AppError(ErrorIds.FILE_TYPE_REJECTED, `kind must be one of ${KINDS.join(', ')}`, {
      kind: value,
    })
  }
  return found
}

/** A trimmed query value, never null: the branches above wanted the same two fallbacks. */
function searchValue(url: URL, name: string): string {
  return (url.searchParams.get(name) ?? '').trim()
}

function statusFor(id: string): number {
  if (id === ErrorIds.AUTH_NO_SESSION || id === ErrorIds.AUTH_FORBIDDEN_ROLE) return 401
  if (id === ErrorIds.FILE_TOO_LARGE) return 413
  if (id === ErrorIds.FILE_TYPE_REJECTED) return 415
  if (id === ErrorIds.CFG_BINDING_MISSING || id === ErrorIds.CFG_ENV_MISSING) return 503
  return 400
}
