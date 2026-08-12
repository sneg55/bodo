// The archive itself: candidates in, one streaming zip out.
//
// Nothing here buffers. Each member is opened only when the writer reaches it
// (`ZipSource.open`) and its bytes are passed straight from the R2 stream into the archive
// stream, so a fifty-file bundle of 25 MB decks costs one chunk of memory rather than
// 1.2 GB. That is the whole reason the writer is STORE-only: see src/utils/zip.ts.
//
// The event-scope check runs BEFORE the first byte, over every key at once, and it refuses
// the whole archive rather than filtering. A bundle that silently omits a file looks
// complete to the organizer, which is worse than one that fails with a reason.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type BundleGrouping, bundleEntryPaths } from '@/features/bundle/grouping'
import { assertKeysInEventScope } from '@/features/bundle/object-scope'
import type { BundleCandidate } from '@/features/bundle/reads'
import { getUploadBucket } from '@/utils/cf'
import {
  assertClassicZipFits,
  storedArchiveSize,
  type ZipSource,
  zipArchiveStream,
} from '@/utils/zip'

export type BundleArchive = {
  readonly filename: string
  readonly body: ReadableStream<Uint8Array>
  /** Exact, because a STORE archive's length is arithmetic. Sent as Content-Length. */
  readonly totalBytes: number
  readonly fileCount: number
}

/**
 * `abstracts-files-2026-08-09.zip`. Date only, since a second bundle on the same day is a
 * browser rename rather than a different thing, and a full timestamp in a filename is
 * noise the organizer then has to read past in their downloads folder.
 *
 * The prefix defaults to `abstracts` because the Options menu on the submissions surfaces
 * was the only caller when this was written. The Files lists pass `files`, since a headshot
 * exported from PORTALS > Files is not an abstract and a downloads folder full of
 * `abstracts-files-*.zip` from two different screens is not something an organizer can sort.
 */
export function bundleFilename(nowIso: string, prefix = 'abstracts'): string {
  return `${prefix}-files-${nowIso.slice(0, 10)}.zip`
}

/**
 * Total bytes and member paths for a selection, without opening anything.
 *
 * Shared with the modal, which shows the total before the organizer commits, so the number
 * in the email and the number on the button come from the same arithmetic.
 */
export function plannedArchive(
  files: readonly BundleCandidate[],
  grouping: BundleGrouping,
): { readonly entries: readonly { id: string; path: string }[]; readonly totalBytes: number } {
  const entries = bundleEntryPaths(files, grouping)
  const sizeById = new Map(files.map((file) => [file.id, file.size]))
  return {
    entries,
    totalBytes: storedArchiveSize(
      entries.map((entry) => ({ path: entry.path, size: sizeById.get(entry.id) ?? 0 })),
    ),
  }
}

export async function buildBundleArchive(input: {
  eventId: string
  files: readonly BundleCandidate[]
  allowedSpeakerIds: readonly string[]
  grouping: BundleGrouping
  nowIso: string
  /** Leading word of the downloaded filename. See `bundleFilename`. */
  filenamePrefix?: string
}): Promise<BundleArchive> {
  if (input.files.length === 0) {
    throw new AppError(
      ErrorIds.DATA_RECORD_NOT_FOUND,
      'the selected sessions have no files to download',
      { eventId: input.eventId },
    )
  }

  // Before the bucket is even asked for, so a scope failure never opens a connection.
  assertKeysInEventScope({
    objects: input.files,
    allowedSpeakerIds: input.allowedSpeakerIds,
    eventId: input.eventId,
  })

  const bucket = await getUploadBucket()
  const { entries, totalBytes } = plannedArchive(input.files, input.grouping)
  const fits = assertClassicZipFits(entries.length, totalBytes)
  if (!fits.ok) {
    throw new AppError(ErrorIds.FILE_TOO_LARGE, fits.reason, {
      eventId: input.eventId,
      fileCount: entries.length,
      totalBytes,
    })
  }
  const keyById = new Map(input.files.map((file) => [file.id, file.objectKey]))

  const sources: readonly ZipSource[] = entries.map((entry) => ({
    path: entry.path,
    open: async () => {
      const objectKey = keyById.get(entry.id)
      if (objectKey === undefined) {
        throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'a planned member lost its object key', {
          fileId: entry.id,
        })
      }
      const object = await bucket.get(objectKey)
      if (object === null) {
        // The Files row is verified at upload time (`verifiedAt`), so a missing object means
        // the bucket and the base have diverged. Failing names which key, because the
        // alternative is a truncated archive that still says "No errors detected".
        throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'a file in the bundle is missing', {
          objectKey,
        })
      }
      return object.body
    },
  }))

  return {
    filename: bundleFilename(input.nowIso, input.filenamePrefix),
    body: zipArchiveStream(sources),
    totalBytes,
    fileCount: entries.length,
  }
}
