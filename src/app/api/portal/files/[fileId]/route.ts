// GET /api/portal/files/<fileId>: a speaker downloading their own stored object.
//
// The portal half of `/api/files/<fileId>`. That route guards on
// `requireEventRole(eventId, 'reviewer')`, a role no speaker holds, so until this existed
// every private object in the portal was unreachable to the person who uploaded it: the
// submission detail's Files card listed the filename, the size and a `Private` badge, and
// there was nothing to click. A speaker deliberately re-uploading a corrected deck could
// not open either version to see which was which.
//
// A Route Handler and not a Server Action, for the reason the admin and bundle routes both
// give: an action returns a serialized value and a file is bytes. It also has to be a plain
// GET so an anchor can point at it.
//
// It authorizes ITSELF, and the URL carries no capability. `getOwnFile` resolves the id
// inside the set the acting speaker can reach rather than loading the row and then asking
// whether it is allowed, so a foreign file id is a 404 rather than a disclosure that the id
// exists. See `features/portal/own-file.ts`.

import { AppError, type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { safeFilename } from '@/features/files/download'
import { getOwnFile } from '@/features/portal/own-file'
import { getUploadBucket } from '@/utils/cf'

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await context.params
    const submission = new URL(request.url).searchParams.get('submission') ?? undefined
    return await handle(fileId, submission)
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json({ error: error.message, id: error.id }, { status: statusFor(error.id) })
    }
    // Logged before rethrowing, as the sibling routes do: an R2 failure can surface as a
    // plain TypeError inside the binding, and a bare 500 with an empty body leaves nothing
    // to grep for in `wrangler tail`.
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] unhandled portal file download failure`,
      error instanceof Error ? error.stack : String(error),
    )
    throw error
  }
}

async function handle(fileId: string, submissionCode?: string): Promise<Response> {
  const file = await getOwnFile(fileId, submissionCode)

  const object = await (await getUploadBucket()).get(file.objectKey)
  if (object === null) {
    // The row exists and the object does not, so the base and the bucket have diverged.
    // Named rather than reported as a generic 404, because the two are fixed by completely
    // different people.
    throw new AppError(ErrorIds.FILE_UPLOAD_FAIL, 'that file is no longer in storage', {
      fileId,
      objectKey: file.objectKey,
    })
  }

  return new Response(object.body, {
    headers: {
      'content-type': file.contentType,
      // `attachment`, so a PDF saves rather than replacing the portal tab the speaker
      // clicked from. The filename is theirs, quoted, with quotes and control characters
      // stripped: it came from a file picker and lands in a response header, where a stray
      // quote would truncate the header value.
      'content-disposition': `attachment; filename="${safeFilename(file.filename)}"`,
      'content-length': String(file.size),
      // Never cached by a shared cache: the URL is the same for everyone and the response is
      // only theirs because of the session that fetched it.
      'cache-control': 'private, no-store',
    },
  })
}

function statusFor(id: ErrorId): number {
  if (id.startsWith('E_AUTH')) return 401
  if (id === ErrorIds.DATA_RECORD_NOT_FOUND) return 404
  return 400
}
