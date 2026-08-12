'use server'

// The two Server Actions behind EXPORT on the File Requests board.
//
// The siblings of ./file-actions, and deliberately the same return shapes: the dialog behind
// both is one component, and the download is the same route, because a ticked request resolves
// to files and files are all the archive has ever known about. What is different is the
// resolution in front of that (./request-selection) and the sentence it produces about the
// requests nobody has delivered.
//
// Both authorize for themselves, in the function the client calls, because a layout is not a
// security boundary (bodo-conventions, "Routes"). `reviewer` rather than `admin`, matching the
// file exports: this hands over data the role already reads on the board. Note that ASSIGN
// beside it requires `admin`, so a reviewer can export what has arrived without being able to
// ask anybody for anything.
//
// Neither writes, so neither invalidates.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { plannedArchive } from '@/features/bundle/archive'
import type { FileBundleRow, PreparedFileBundle } from '@/features/bundle/file-actions'
import { fileBundleDownloadPath } from '@/features/bundle/file-link'
import type { BundleGrouping } from '@/features/bundle/grouping'
import { loadRequestBundleCandidates } from '@/features/bundle/request-reads'
import { MAX_BUNDLE_REQUESTS } from '@/features/bundle/request-selection'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import type { RecordId } from '@/types/domain'

export type RequestBundleListing = {
  readonly files: readonly FileBundleRow[]
  /**
   * "3 selected file requests have no upload yet...". Present whenever a ticked request is
   * unfulfilled, INCLUDING when that leaves nothing to download, because that case is the one
   * where the organizer most needs to be told why the dialog is empty.
   */
  readonly notice?: string
  readonly problem?: 'empty' | 'too-many'
}

/**
 * What the dialog lists: the latest version of every file delivered against the ticked
 * requests, plus the notice naming the requests that have none.
 *
 * The scope problems come back as DATA rather than as a failure, for the same reason they do
 * on the files surfaces: "nothing is ticked" is a normal state of the board this opens from.
 */
export async function listRequestBundleAction(input: {
  eventId: RecordId
  fileRequestIds: readonly string[]
}): Promise<ActionResult<RequestBundleListing>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const candidates = await loadRequestBundleCandidates({
      eventId: input.eventId,
      checkedRequestIds: input.fileRequestIds,
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
      ...(candidates.notice === undefined ? {} : { notice: candidates.notice }),
      ...(candidates.plan.problem === undefined ? {} : { problem: candidates.plan.problem }),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * The two refusals, worded for the board this opened from.
 *
 * Not exported, which a `'use server'` module requires of anything that is not an async
 * function, and which is right anyway: these sentences belong to this pair of actions.
 */
function scopeFailure(problem: 'empty' | 'too-many'): AppError {
  if (problem === 'too-many') {
    return new AppError(
      ErrorIds.SUB_VALIDATION_FAIL,
      `An export covers at most ${String(MAX_BUNDLE_REQUESTS)} file requests at a time.`,
      { problem },
    )
  }
  return new AppError(
    ErrorIds.SUB_VALIDATION_FAIL,
    'Select the file requests you want before generating a download.',
    { problem },
  )
}

/**
 * Resolve the ticked requests one last time, then hand back the URL that streams the result.
 *
 * The URL carries FILE ids, not request ids, so the download route is the same one the Files
 * lists use and needs to know nothing about requests. The re-read here is what makes the count
 * in the confirmation and the members of the archive the same set: a speaker can deliver
 * between the dialog opening and the button being pressed.
 */
export async function prepareRequestBundleAction(input: {
  eventId: RecordId
  fileRequestIds: readonly string[]
  grouping: BundleGrouping
  /** Files the organizer unticked in the dialog. Applied here, not in the URL. */
  deselectedFileIds: readonly string[]
}): Promise<ActionResult<PreparedFileBundle>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const candidates = await loadRequestBundleCandidates({
      eventId: input.eventId,
      checkedRequestIds: input.fileRequestIds,
      deselectedFileIds: input.deselectedFileIds,
    })
    if (candidates.plan.problem !== undefined) throw scopeFailure(candidates.plan.problem)
    if (candidates.files.length === 0) {
      throw new AppError(
        ErrorIds.DATA_RECORD_NOT_FOUND,
        'Nothing has been delivered against the selected file requests, so there is nothing to download.',
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
