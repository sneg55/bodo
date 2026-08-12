// GET /api/files/bundle: the emailed link. Streams the archive, never buffers it.
//
// A Route Handler and not a Server Action, for the same reason the upload is one: an action
// returns a serialized value, and a bundle is bytes. It also has to be a plain GET, because
// the thing that opens it is a link in a mail client.
//
// It authorizes ITSELF, which is the whole security model of this feature. The URL carries
// the selection and carries no capability: `requireEventRole` reads the caller's session on
// this request, the event's sessions and its speaker roster are re-read event-scoped, and
// every object key is checked against that roster before a byte moves
// (@/features/bundle/object-scope). So a URL forwarded to somebody without a membership is a
// 401, and a session id pasted in from another conference resolves to nothing.
//
// Nothing here decides anything: the selection rules are in @/features/bundle and the writer
// is in @/utils/zip, because `src/app/**` wires and renders (bodo-conventions, "Routes").

import { type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { buildBundleArchive } from '@/features/bundle/archive'
import { parseBundleRequest } from '@/features/bundle/link'
import { loadBundleCandidates } from '@/features/bundle/reads'

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request)
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json({ error: error.message, id: error.id }, { status: statusFor(error.id) })
    }
    // Logged before rethrowing, because the archive path can fail inside a binding with a
    // plain TypeError (that is exactly how the R2 unsized-stream bug surfaced on the upload
    // route), and a bare 500 with an empty body leaves nothing to grep for in wrangler tail.
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] unhandled bundle download failure`,
      error instanceof Error ? error.stack : String(error),
    )
    throw error
  }
}

async function handle(request: Request): Promise<Response> {
  const parsed = parseBundleRequest(new URL(request.url).searchParams)
  // Before anything is read. `requireEventRole` throws AUTH_FORBIDDEN_ROLE for a blank id
  // just as it does for an event the caller has no membership on, so an empty parameter is
  // refused rather than treated as "no scope".
  await requireEventRole(parsed.eventId, 'reviewer')

  const candidates = await loadBundleCandidates({
    eventId: parsed.eventId,
    checkedSessionIds: parsed.sessionIds,
    deselectedFileIds: parsed.deselectedFileIds,
  })

  const archive = await buildBundleArchive({
    eventId: parsed.eventId,
    files: candidates.files,
    allowedSpeakerIds: candidates.speakerIds,
    grouping: parsed.grouping,
    nowIso: new Date().toISOString(),
  })

  return new Response(archive.body, {
    headers: {
      'content-type': 'application/zip',
      // Exact, because a STORE archive's length is arithmetic rather than a guess
      // (`storedArchiveSize`). It is what gives the browser a real progress bar on a
      // download that can run to hundreds of megabytes.
      'content-length': String(archive.totalBytes),
      'content-disposition': `attachment; filename="${archive.filename}"`,
      // The bundle is per-caller and per-selection, and it holds private slide decks. A
      // shared cache must never keep a copy.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function statusFor(id: ErrorId): number {
  if (id === ErrorIds.AUTH_NO_SESSION || id === ErrorIds.AUTH_FORBIDDEN_ROLE) return 401
  if (id === ErrorIds.DATA_RECORD_NOT_FOUND) return 404
  if (id === ErrorIds.FILE_TOO_LARGE) return 413
  if (id === ErrorIds.CFG_BINDING_MISSING || id === ErrorIds.CFG_ENV_MISSING) return 503
  return 400
}
