// GET /api/files/<fileId>: download one stored object, authenticated.
//
// This is the route the Files table has been promising and did not have. A PRIVATE object
// has no public URL by design, so the table rendered a "Private" badge and stopped there,
// and its own comment said such objects are "served through an authenticated route" that
// nobody had written. The effect was that an organizer could see a speaker's deliverable,
// its size, its type and when it arrived, and could not open it: the one thing a file
// surface exists for. A speaker deliverable is private by default, so this was not an edge
// case, it was the normal case.
//
// A Route Handler and not a Server Action, for the reason the bundle route gives about
// itself: an action returns a serialized value, and a file is bytes. It also has to be a
// plain GET so that an anchor can point at it.
//
// It authorizes ITSELF and the URL carries no capability. The event id is in the query
// string because a Files row records a speaker and never an event, so there is nothing on
// the file to scope by; what there is, is the event's speaker roster, and a file whose
// owner is not on it is not this event's file (see `features/files/download.ts`). Naming an
// event you have no role on is a 401, and naming your own with a foreign file id is a 404
// rather than a disclosure that the id exists. So possession of a file id grants nothing,
// which is what lets this link sit in an ordinary anchor.

import { AppError, type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { getEventFile, safeFilename } from '@/features/files/download'
import { getUploadBucket } from '@/utils/cf'

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await context.params
    return await handle(fileId, new URL(request.url).searchParams.get('event') ?? '')
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json({ error: error.message, id: error.id }, { status: statusFor(error.id) })
    }
    // Logged before rethrowing, for the reason the bundle route records: an R2 failure can
    // surface as a plain TypeError inside the binding, and a bare 500 with an empty body
    // leaves nothing to grep for in `wrangler tail`.
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] unhandled file download failure`,
      error instanceof Error ? error.stack : String(error),
    )
    throw error
  }
}

async function handle(fileId: string, eventId: string): Promise<Response> {
  // BEFORE anything is read, so a caller with no membership never causes a listing.
  // `requireEventRole` throws AUTH_FORBIDDEN_ROLE for a blank id exactly as it does for an
  // event the caller has no membership on, so a missing parameter is refused rather than
  // treated as "no scope". `reviewer` is the floor rather than `admin`: a reviewer scoring
  // an abstract needs the slides attached to it, and it is the guard the bundle uses.
  await requireEventRole(eventId, 'reviewer')

  const file = await getEventFile(eventId, fileId)

  const object = await (await getUploadBucket()).get(file.objectKey)
  if (object === null) {
    // The row exists and the object does not, which means the base and the bucket have
    // diverged. Named rather than reported as a generic 404, because the two are fixed by
    // completely different people.
    throw new AppError(ErrorIds.FILE_UPLOAD_FAIL, 'that file is no longer in storage', {
      fileId,
      objectKey: file.objectKey,
    })
  }

  return new Response(object.body, {
    headers: {
      'content-type': file.contentType,
      // `attachment`, so a PDF or an image saves rather than replacing the admin tab the
      // organizer clicked from. The filename is the one the speaker uploaded, quoted, with
      // quotes and control characters stripped: it reaches us from a file picker and lands
      // in a response header, where a stray quote would truncate the header value.
      'content-disposition': `attachment; filename="${safeFilename(file.filename)}"`,
      // A stored object's size is known exactly, so the browser gets a real progress bar.
      'content-length': String(file.size),
      // Never cached by a shared cache: the URL is the same for everyone and the response
      // is only theirs because of the session that fetched it.
      'cache-control': 'private, no-store',
    },
  })
}

function statusFor(id: ErrorId): number {
  if (id.startsWith('E_AUTH')) return 401
  if (id === ErrorIds.DATA_RECORD_NOT_FOUND) return 404
  return 400
}
