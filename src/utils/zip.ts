// A STORE-only streaming zip writer. No dependency, no compression, nothing buffered.
//
// Three decisions, and each of them is the reason this file exists rather than an npm
// package.
//
//   1. NO LIBRARY. The deployed Worker has roughly 76 KiB of gzip headroom against
//      Cloudflare's 3 MiB script limit, and the last dependency added (postcss, pulled in
//      by sanitize-html) failed deploy validation at 3142 KiB. A zip library is not worth
//      the whole remaining budget.
//   2. STORE, not DEFLATE. The payload is presentation files: PDF, PPTX, JPEG, PNG. Those
//      are already compressed, so DEFLATE would spend CPU to save single-digit percent.
//      STORE also means a member's bytes are copied through untouched, so a 25 MB deck is
//      never held anywhere: the chunk R2 hands over is the chunk that is yielded.
//   3. DATA DESCRIPTORS, not a wrong CRC. See `FLAGS` in ./zip-records.
//
// The record layouts, the CRC-32 and the size arithmetic are in ./zip-records, which is
// pure. This file is the state machine that emits them in order and pulls the member
// bytes through in between.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  centralHeader,
  crc32,
  dataDescriptor,
  endOfCentralDirectory,
  localHeader,
  UINT16_MAX,
  UINT32_MAX,
  ZIP_NAMES,
  type ZipMember,
} from '@/utils/zip-records'

export { assertClassicZipFits, crc32, storedArchiveSize } from '@/utils/zip-records'

/**
 * One member of the archive.
 *
 * `open` is a function rather than a stream so nothing is opened until the writer reaches
 * it. Handing over a hundred live R2 streams up front would keep a hundred connections
 * open for the length of the download.
 */
export type ZipSource = {
  /** Forward-slash separated path inside the archive. Sanitized by the caller. */
  readonly path: string
  readonly open: () => Promise<ReadableStream<Uint8Array>>
}

/**
 * Refuse an offset that would overflow the field it has to be written into, so the failure
 * is an error rather than a silently corrupt central directory. This is the point where a
 * real product reaches for zip64; a selection that large is out of scope here and saying
 * so is better than writing a truncated offset.
 */
function assertFits(offset: number): void {
  if (offset > UINT32_MAX) {
    throw new AppError(
      ErrorIds.FILE_TOO_LARGE,
      'the archive is larger than a 32-bit zip can address; download a smaller selection',
      { offset },
    )
  }
}

async function* archiveParts(sources: readonly ZipSource[]): AsyncGenerator<Uint8Array> {
  if (sources.length > UINT16_MAX) {
    throw new AppError(ErrorIds.FILE_TOO_LARGE, 'a zip holds at most 65535 members', {
      members: sources.length,
    })
  }

  const directory: ZipMember[] = []
  let offset = 0

  for (const source of sources) {
    const name = ZIP_NAMES.encode(source.path)
    const headerOffset = offset
    const header = localHeader(name)
    yield header
    offset += header.length

    let crc = 0
    let size = 0
    const reader = (await source.open()).getReader()
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        crc = crc32(chunk.value, crc)
        size += chunk.value.length
        // Passed straight through. This is the line that makes the writer streaming: a
        // member's bytes are never accumulated anywhere.
        yield chunk.value
      }
    } finally {
      reader.releaseLock()
    }

    const descriptor = dataDescriptor(crc, size)
    yield descriptor
    offset += size + descriptor.length
    assertFits(offset)
    directory.push({ name, crc, size, headerOffset })
  }

  const directoryOffset = offset
  let directorySize = 0
  for (const member of directory) {
    const header = centralHeader(member)
    yield header
    directorySize += header.length
  }
  assertFits(directoryOffset + directorySize)

  yield endOfCentralDirectory(directory.length, directorySize, directoryOffset)
}

/**
 * The archive as a stream.
 *
 * Driven from `pull` rather than filled in `start`, and that is the whole memory
 * guarantee: `pull` is called only while the consumer has room, so a slow reader stalls
 * the generator mid-member instead of letting the internal queue swallow the file. A
 * `start`-based writer passes the same archive tests and buffers everything.
 */
export function zipArchiveStream(sources: readonly ZipSource[]): ReadableStream<Uint8Array> {
  const parts = archiveParts(sources)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await parts.next()
      if (next.done === true) {
        controller.close()
        return
      }
      controller.enqueue(next.value)
    },
    async cancel(reason) {
      // Propagates to the R2 reader inside the generator's `finally`, so an abandoned
      // download does not leave a member half-read.
      await parts.return(reason)
    },
  })
}
