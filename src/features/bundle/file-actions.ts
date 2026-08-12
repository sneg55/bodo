'use server'

// The two Server Actions behind EXPORT on the admin Files lists.
//
// Both authorize for themselves, in the function the client calls, because a layout is not a
// security boundary (bodo-conventions, "Routes"). Both return a Result rather than throwing,
// so a refusal an organizer can act on reaches the dialog as a sentence instead of a redacted
// production digest.
//
// Neither writes anything, so neither invalidates. The download itself is not here: it is
// bytes, so it is a GET the browser navigates to (src/app/api/files/bundle/selection). What
// `prepareFileBundleAction` returns is the URL for that navigation, computed from a fresh
// read, so the archive the browser then fetches is built from the same selection the dialog
// listed rather than from ids the client assembled on its own.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { plannedArchive } from '@/features/bundle/archive'
import { fileBundleDownloadPath } from '@/features/bundle/file-link'
import { loadFileBundleCandidates } from '@/features/bundle/file-reads'
import { type FileSelectionScope, MAX_BUNDLE_FILES } from '@/features/bundle/file-selection'
import type { BundleGrouping } from '@/features/bundle/grouping'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import type { RecordId } from '@/types/domain'

/** One row in the dialog's file list. Flat and serializable: it crosses to the client. */
export type FileBundleRow = {
  readonly id: string
  readonly filename: string
  readonly size: number
  /** `headshot` / `slides` / `doc`. Carried so the `File type` grouping folders correctly. */
  readonly kind: string
  readonly sessionLabel: string
  readonly speakerLabel: string
}

export type FileBundleListing = {
  readonly files: readonly FileBundleRow[]
  /** Ticked ids the event does not contain, dropped. Surfaced so a stale tick is visible. */
  readonly foreign: number
  readonly problem?: FileSelectionScope['problem']
}

/**
 * What the dialog lists: the latest version of everything the ticks touched.
 *
 * The scope problems come back as DATA rather than as a failure. "Nothing is ticked" is a
 * normal state of the screen this opens from, and an error toast for it would be wrong.
 */
export async function listFileBundleAction(input: {
  eventId: RecordId
  fileIds: readonly string[]
}): Promise<ActionResult<FileBundleListing>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const candidates = await loadFileBundleCandidates({
      eventId: input.eventId,
      checkedFileIds: input.fileIds,
    })

    return actionOk({
      files: candidates.files.map((file) => ({
        id: file.id,
        filename: file.filename,
        size: file.size,
        kind: file.kind,
        sessionLabel: file.sessionLabel,
        speakerLabel: file.speakerLabel,
      })),
      foreign: candidates.scope.foreign,
      ...(candidates.scope.problem === undefined ? {} : { problem: candidates.scope.problem }),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The two refusals the dialog can produce, worded for the screen it opened from.
 *
 * Not exported, which a `'use server'` module requires of anything that is not an async
 * function, and which is right anyway: these sentences belong to this pair of actions.
 */
function scopeFailure(problem: 'empty' | 'too-many'): AppError {
  if (problem === 'too-many') {
    return new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `A download covers at most ${String(MAX_BUNDLE_FILES)} files at a time. Untick some rows and try again.`,
      { problem },
    )
  }
  return new AppError(
    ErrorIds.SUB_VALIDATION_FAIL,
    'Select the files you want before generating a download.',
    { problem },
  )
}

export type PreparedFileBundle = {
  readonly fileCount: number
  readonly totalBytes: number
  /** Where the browser navigates to start the download. Relative, same origin. */
  readonly downloadPath: string
}

/**
 * Resolve the selection one last time, then hand back the URL that streams it.
 *
 * The re-read is the point rather than a precaution: between opening the dialog and pressing
 * the button a row can be deleted or superseded, and this is what makes the count in the
 * confirmation and the members of the archive the same set. The URL carries the ids this read
 * produced, so the route's own re-read has nothing left to disagree with.
 */
export async function prepareFileBundleAction(input: {
  eventId: RecordId
  fileIds: readonly string[]
  grouping: BundleGrouping
  /** Files the organizer unticked in the dialog. Applied here, not in the URL. */
  deselectedFileIds: readonly string[]
}): Promise<ActionResult<PreparedFileBundle>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const candidates = await loadFileBundleCandidates({
      eventId: input.eventId,
      checkedFileIds: input.fileIds,
      deselectedFileIds: input.deselectedFileIds,
    })
    if (candidates.scope.problem !== undefined) throw scopeFailure(candidates.scope.problem)
    if (candidates.files.length === 0) {
      throw new AppError(
        ErrorIds.DATA_RECORD_NOT_FOUND,
        'Every file in this selection was unticked, so there is nothing to download.',
        { eventId: input.eventId },
      )
    }

    const { totalBytes } = plannedArchive(candidates.files, input.grouping)
    return actionOk({
      fileCount: candidates.files.length,
      totalBytes,
      downloadPath: fileBundleDownloadPath({
        eventId: input.eventId,
        fileIds: candidates.files.map((file) => file.id),
        grouping: input.grouping,
      }),
    })
  } catch (error) {
    return actionFailure(error)
  }
}
