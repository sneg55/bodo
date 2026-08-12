'use server'

// The two Server Actions behind `Download files bundle...`.
//
// Both authorize for themselves, in the function the client calls, because a layout is not
// a security boundary (bodo-conventions, "Routes"). Both return a Result rather than
// throwing, so a refusal an organizer can act on ("select some abstracts first") reaches the
// modal as a sentence instead of a redacted production digest.
//
// Neither writes anything the caches care about, so neither invalidates: the listing read is
// tagged where it happens (`submission:{id}:files`, via the DAL) and the only write in the
// whole feature is `enqueueEmails`, which expires the event's outbox tag itself.

import { requireEventRole } from '@/features/auth/wiring'
import type { BundleGrouping } from '@/features/bundle/grouping'
import { loadBundleCandidates } from '@/features/bundle/reads'
import { requestFileBundle } from '@/features/bundle/request'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import type { SubmissionScope } from '@/features/review/submission-scope'
import type { RecordId } from '@/types/domain'

/** One row in the modal's file list. Flat and serializable: it crosses to the client. */
export type BundleFileRow = {
  readonly id: string
  readonly filename: string
  readonly size: number
  /**
   * `headshot` / `slides` / `doc`.
   *
   * Added because the modal previews the archive's paths locally, and without it the preview
   * passed a hardcoded `doc` into `bundleEntryPaths`: under the `File type` grouping every
   * file then folded into one `Documents/` folder, so the collision suffixes and therefore the
   * size the modal showed did not match the archive the route would build. The server has
   * always had the real value on `BundleCandidate`.
   */
  readonly kind: string
  readonly sessionLabel: string
  readonly speakerLabel: string
}

export type BundleListing = {
  readonly files: readonly BundleFileRow[]
  readonly sessionCount: number
  /** Checked ids the event does not contain, dropped. Surfaced so a stale tick is visible. */
  readonly foreign: number
  readonly problem?: 'empty' | 'too-many'
}

/**
 * What the modal lists: latest version of every file on the checked sessions.
 *
 * The scope problems come back as DATA rather than as a failure, because "nothing is ticked"
 * is the modal's normal opening state on a surface where the organizer may not have selected
 * anything yet, and an error toast for it would be wrong.
 */
export async function listBundleFilesAction(input: {
  eventId: RecordId
  sessionIds: readonly string[]
}): Promise<ActionResult<BundleListing>> {
  try {
    await requireEventRole(input.eventId, 'reviewer')

    const candidates = await loadBundleCandidates({
      eventId: input.eventId,
      checkedSessionIds: input.sessionIds,
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
      sessionCount: candidates.sessionCount,
      foreign: candidates.scope.foreign,
      problem: candidates.scope.problem,
    })
  } catch (error) {
    return actionFailure(error)
  }
}

// There is deliberately no action for the archive's SIZE. It is arithmetic over the list the
// modal already holds (`bundleEntryPaths` plus `storedArchiveSize`, both pure), and the
// grouping select changes it on every keystroke-equivalent, so a round trip per change would
// be a request per click for a number the client can compute. The dialog imports the two
// functions directly.

export async function generateBundleAction(input: {
  eventId: RecordId
  sessionIds: readonly string[]
  grouping: BundleGrouping
  deselectedFileIds: readonly string[]
  /**
   * Which of the three submission surfaces the modal was opened from. Only the wording of a
   * refusal depends on it, and the dialog's own inline messages read the same entry, so the
   * toast and the panel cannot call the same rows two different things.
   */
  surface: SubmissionScope
}): Promise<
  ActionResult<{
    fileCount: number
    totalBytes: number
    toEmail: string
    alreadyQueued: boolean
  }>
> {
  try {
    const outcome = await requestFileBundle(
      {
        eventId: input.eventId,
        sessionIds: input.sessionIds,
        grouping: input.grouping,
        deselectedFileIds: input.deselectedFileIds,
      },
      Date.now(),
      input.surface,
    )
    return actionOk({
      fileCount: outcome.fileCount,
      totalBytes: outcome.totalBytes,
      toEmail: outcome.toEmail,
      alreadyQueued: outcome.alreadyQueued,
    })
  } catch (error) {
    return actionFailure(error)
  }
}
