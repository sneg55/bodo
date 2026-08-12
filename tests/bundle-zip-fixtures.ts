// Shared helpers for the two archive suites (bundle-zip and bundle-zip-unzip).
//
// Not a `.test.ts` file, so vitest does not collect it: `include` is `tests/**/*.test.ts`.
// It exists because the layout suite and the real-unzip suite need the same fixture
// streams, and a second copy of `collect` is exactly how the two suites end up asserting
// against subtly different bytes.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ZipSource, zipArchiveStream } from '@/utils/zip'

export const TEXT = new TextEncoder()

/**
 * A member whose body arrives in `chunks` pieces.
 *
 * Chunking is a parameter rather than always one piece because the CRC has to accumulate
 * across reads: a single-chunk fixture would pass even if the resumable seed were dropped.
 */
export function source(path: string, body: string, chunks = 1): ZipSource {
  const bytes = TEXT.encode(body)
  const per = Math.max(1, Math.ceil(bytes.length / chunks))
  return {
    path,
    open: () =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < bytes.length; at += per) {
              controller.enqueue(bytes.slice(at, at + per))
            }
            controller.close()
          },
        }),
      ),
  }
}

export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    parts.push(chunk.value)
  }

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export async function build(sources: readonly ZipSource[]): Promise<Uint8Array> {
  return await collect(zipArchiveStream(sources))
}

/** The archive on disk, in its own temp directory, for a command line tool to open. */
export function writeArchive(name: string, bytes: Uint8Array): string {
  const path = join(mkdtempSync(join(tmpdir(), 'bodo-bundle-')), name)
  writeFileSync(path, bytes)
  return path
}

export function tempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'bodo-bundle-out-'))
}

/** Whether Info-ZIP is on this machine. Absent skips the suite rather than failing it. */
export function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
