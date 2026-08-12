// What the export dialog was opened over: file rows, or file requests.
//
// One dialog serves both because after the resolution they are the same thing, a list of
// files with a grouping and some unticks, and two near-identical modals is exactly the
// duplication the shared-primitive rule exists to prevent. What differs is which pair of
// Server Actions answers, and the sentence shown when the selection resolves to nothing.
//
// This module is the seam. It holds no state and renders nothing, so the dialog keeps its
// state and its markup and gains no branching beyond one `source` prop.

import {
  type FileBundleRow,
  listFileBundleAction,
  prepareFileBundleAction,
} from '@/features/bundle/file-actions'
import { MAX_BUNDLE_FILES } from '@/features/bundle/file-selection'
import type { BundleGrouping } from '@/features/bundle/grouping'
import {
  listRequestBundleAction,
  prepareRequestBundleAction,
} from '@/features/bundle/request-actions'
import { MAX_BUNDLE_REQUESTS } from '@/features/bundle/request-selection'

export type BundleSource =
  /** Ticked rows on SUBMISSIONS > Files or PORTALS > Files. */
  | { readonly kind: 'files'; readonly fileIds: readonly string[] }
  /** Ticked cards on the File Requests board. These resolve to files server-side. */
  | { readonly kind: 'requests'; readonly fileRequestIds: readonly string[] }

export type SourceListing =
  | {
      readonly ok: true
      readonly files: readonly FileBundleRow[]
      readonly notice?: string
      readonly problem?: 'empty' | 'too-many'
    }
  | { readonly ok: false; readonly message: string }

export async function listBundleSource(
  eventId: string,
  source: BundleSource,
): Promise<SourceListing> {
  if (source.kind === 'files') {
    const result = await listFileBundleAction({ eventId, fileIds: [...source.fileIds] })
    return result.ok
      ? {
          ok: true,
          files: result.files,
          ...(result.problem === undefined ? {} : { problem: result.problem }),
        }
      : { ok: false, message: result.message }
  }

  const result = await listRequestBundleAction({
    eventId,
    fileRequestIds: [...source.fileRequestIds],
  })
  return result.ok
    ? {
        ok: true,
        files: result.files,
        ...(result.notice === undefined ? {} : { notice: result.notice }),
        ...(result.problem === undefined ? {} : { problem: result.problem }),
      }
    : { ok: false, message: result.message }
}

export type PreparedSource =
  | {
      readonly ok: true
      readonly downloadPath: string
      readonly fileCount: number
      readonly totalBytes: number
    }
  | { readonly ok: false; readonly message: string }

export async function prepareBundleSource(input: {
  eventId: string
  source: BundleSource
  grouping: BundleGrouping
  deselectedFileIds: readonly string[]
}): Promise<PreparedSource> {
  const result =
    input.source.kind === 'files'
      ? await prepareFileBundleAction({
          eventId: input.eventId,
          fileIds: [...input.source.fileIds],
          grouping: input.grouping,
          deselectedFileIds: [...input.deselectedFileIds],
        })
      : await prepareRequestBundleAction({
          eventId: input.eventId,
          fileRequestIds: [...input.source.fileRequestIds],
          grouping: input.grouping,
          deselectedFileIds: [...input.deselectedFileIds],
        })

  return result.ok
    ? {
        ok: true,
        downloadPath: result.downloadPath,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes,
      }
    : { ok: false, message: result.message }
}

/**
 * Why the dialog has nothing to show, in the vocabulary of the screen it was opened from.
 *
 * `undefined` means there is something to show. The requests branch never says "no files
 * match" on its own, because `unfulfilledNotice` has already named the undelivered rows above
 * this sentence and repeating the count here would read as two different problems.
 */
export function sourceEmptyMessage(
  source: BundleSource,
  problem: 'empty' | 'too-many' | undefined,
  files: number,
): string | undefined {
  if (source.kind === 'requests') {
    if (problem === 'empty') {
      return 'Tick the file requests you want, then open this again.'
    }
    if (problem === 'too-many') {
      return `An export covers at most ${String(MAX_BUNDLE_REQUESTS)} file requests at a time.`
    }
    if (files === 0) return 'Nothing has been delivered against this selection yet.'
    return undefined
  }

  if (problem === 'empty') {
    return 'Tick the files you want, then open this again. A download covers the checked selection.'
  }
  if (problem === 'too-many') {
    return `A download covers at most ${String(MAX_BUNDLE_FILES)} files at a time. Untick some rows and try again.`
  }
  if (files === 0) return 'The rows you selected are no longer on this event.'
  return undefined
}
