// GET /api/files/bundle/selection: the ZIP behind EXPORT on the two admin Files lists.
//
// The sibling of ../route.ts, which serves the emailed session bundle. Two routes rather than
// one because the selections are different things: that one names sessions and this one names
// file rows, and the portal list has no sessions to name (features/files/file-rows.ts). They
// share everything that matters after the selection resolves: the same candidate shape, the
// same object-key scope check, the same streaming writer.
//
// A Route Handler and not a Server Action, because an action returns a serialized value and
// an archive is bytes. It is a plain GET so the browser can navigate to it and save the file
// with no JavaScript holding a blob in memory.
//
// It authorizes ITSELF, which is the whole security model. The URL carries the selection and
// carries no capability: `requireEventRole` reads the caller's session on this request, the
// event's speaker roster and its files are re-read event-scoped, the ids in the query are
// intersected with that read, and every object key is then checked against the roster before
// a byte moves (@/features/bundle/object-scope). So a URL forwarded to somebody without a
// membership is a 401, and a file id pasted in from another conference resolves to nothing.
//
// Nothing here decides anything: the selection rules are in @/features/bundle and the writer
// is in @/utils/zip, because `src/app/**` wires and renders (bodo-conventions, "Routes").

import { AppError, type ErrorId, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { buildBundleArchive } from '@/features/bundle/archive'
import { parseFileBundleRequest } from '@/features/bundle/file-link'
import { loadFileBundleCandidates } from '@/features/bundle/file-reads'
import { MAX_BUNDLE_FILES } from '@/features/bundle/file-selection'

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request)
  } catch (error) {
    if (isAppError(error)) {
      console.error(error.toLogLine())
      return Response.json({ error: error.message, id: error.id }, { status: statusFor(error.id) })
    }
    // Logged before rethrowing, because the archive path can fail inside a binding with a
    // plain TypeError (that is how the R2 unsized-stream bug surfaced on the upload route),
    // and a bare 500 with an empty body leaves nothing to grep for in wrangler tail.
    console.error(
      `[${ErrorIds.FILE_UPLOAD_FAIL}] unhandled file bundle download failure`,
      error instanceof Error ? error.stack : String(error),
    )
    throw error
  }
}

async function handle(request: Request): Promise<Response> {
  const parsed = parseFileBundleRequest(new URL(request.url).searchParams)
  // Before anything is read. `requireEventRole` throws AUTH_FORBIDDEN_ROLE for a blank id
  // just as it does for an event the caller has no membership on, so an empty parameter is
  // refused rather than treated as "no scope".
  await requireEventRole(parsed.eventId, 'reviewer')

  const candidates = await loadFileBundleCandidates({
    eventId: parsed.eventId,
    checkedFileIds: parsed.fileIds,
  })
  if (candidates.scope.problem !== undefined) throw scopeFailure(candidates.scope.problem)

  const archive = await buildBundleArchive({
    eventId: parsed.eventId,
    files: candidates.files,
    allowedSpeakerIds: candidates.speakerIds,
    grouping: parsed.grouping,
    nowIso: new Date().toISOString(),
    filenamePrefix: 'files',
  })

  return new Response(archive.body, {
    headers: {
      'content-type': 'application/zip',
      // Exact, because a STORE archive's length is arithmetic rather than a guess
      // (`storedArchiveSize`). It is what gives the browser a real progress bar on a
      // download that can run to hundreds of megabytes.
      'content-length': String(archive.totalBytes),
      'content-disposition': `attachment; filename="${archive.filename}"`,
      // Per-caller, per-selection, and it holds private speaker deliverables. A shared cache
      // must never keep a copy.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * A selection that resolved to nothing is a 404 and not an empty archive.
 *
 * Reachable without a bug: an organizer leaves the dialog open, somebody deletes the rows, and
 * the link they then click names ids the event no longer holds. A zero-member zip that
 * extracts to an empty folder is the one outcome that tells them nothing.
 */
function scopeFailure(problem: 'empty' | 'too-many'): AppError {
  if (problem === 'too-many') {
    return new AppError(
      ErrorIds.FILE_TOO_LARGE,
      `A download covers at most ${String(MAX_BUNDLE_FILES)} files at a time.`,
      { problem },
    )
  }
  return new AppError(
    ErrorIds.DATA_RECORD_NOT_FOUND,
    'none of the selected files are on this event any more',
    { problem },
  )
}

function statusFor(id: ErrorId): number {
  if (id === ErrorIds.AUTH_NO_SESSION || id === ErrorIds.AUTH_FORBIDDEN_ROLE) return 401
  if (id === ErrorIds.DATA_RECORD_NOT_FOUND) return 404
  if (id === ErrorIds.FILE_TOO_LARGE) return 413
  if (id === ErrorIds.CFG_BINDING_MISSING || id === ErrorIds.CFG_ENV_MISSING) return 503
  return 400
}
