// The archive builder end to end: candidates in, a real zip out of a fake bucket.
//
// The pure suites cover the rules and bundle-zip-unzip covers the format. What is left, and
// what this file is for, is the wiring between them: that the grouping decides the folders in
// the archive that is actually produced, that the scope check runs BEFORE anything is opened,
// and that the declared Content-Length matches the bytes that come out. The last one is the
// dangerous one, because a Content-Length that disagrees with the body truncates the download
// in the browser with no error on the server.
//
// The bucket is a Map of streams. `@/utils/cf` is mocked because the real `getUploadBucket`
// reaches for a Cloudflare binding, and nothing else in the file needs the runtime.

import { describe, expect, it, vi } from 'vitest'

import { buildBundleArchive, bundleFilename, plannedArchive } from '@/features/bundle/archive'
import type { BundleCandidate } from '@/features/bundle/reads'
import { buildObjectKey } from '@/services/storage/upload-limits'
import { collect } from './bundle-zip-fixtures'

const TEXT = new TextEncoder()
const ANA = 'rec-speaker-ana'
const BO = 'rec-speaker-bo'
const OUTSIDER = 'rec-speaker-outsider'

const objects = new Map<string, string>()
const opened: string[] = []

vi.mock('@/utils/cf', () => ({
  getUploadBucket: () =>
    Promise.resolve({
      get: (key: string) => {
        const body = objects.get(key)
        if (body === undefined) return Promise.resolve(null)
        opened.push(key)
        return Promise.resolve({
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(TEXT.encode(body))
              controller.close()
            },
          }),
        })
      },
    }),
}))

function candidate(
  over: Partial<BundleCandidate> & { id: string; body?: string },
): BundleCandidate {
  const speakerId = over.speakerLabel === 'Bo Chen' ? BO : ANA
  const objectKey =
    over.objectKey ??
    buildObjectKey({ kind: over.kind ?? 'slides', speakerId, filename: 'deck.pdf' }, over.id)
  const body = over.body ?? `bytes for ${over.id}`
  objects.set(objectKey, body)

  return {
    filename: 'deck.pdf',
    size: TEXT.encode(body).length,
    kind: 'slides',
    speakerId,
    sessionId: 'sub-1',
    sessionLabel: 'SESS-1 Scaling Postgres',
    speakerLabel: 'Ana Ruiz',
    ...over,
    objectKey,
  }
}

const ROSTER = [ANA, BO]
const NOW = '2026-08-09T11:22:33.000Z'

async function archive(
  files: readonly BundleCandidate[],
  grouping: Parameters<typeof buildBundleArchive>[0]['grouping'] = 'session',
  allowedSpeakerIds: readonly string[] = ROSTER,
) {
  return await buildBundleArchive({
    eventId: 'rec-event-1',
    files,
    allowedSpeakerIds,
    grouping,
    nowIso: NOW,
  })
}

/** Member names, read back out of the archive's own central directory. */
function membersOf(bytes: Uint8Array): readonly string[] {
  const view = new DataView(bytes.buffer)
  const eocdAt = bytes.length - 22
  let at = view.getUint32(eocdAt + 16, true)
  const names: string[] = []

  for (let index = 0; index < view.getUint16(eocdAt + 10, true); index += 1) {
    const nameLength = view.getUint16(at + 28, true)
    names.push(new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength)))
    at += 46 + nameLength
  }
  return names
}

describe('bundleFilename', () => {
  it('is dated to the day, not the second', () => {
    expect(bundleFilename(NOW)).toBe('abstracts-files-2026-08-09.zip')
  })
})

describe('buildBundleArchive', () => {
  it('refuses an empty selection rather than mailing a link to an empty zip', async () => {
    await expect(archive([])).rejects.toThrow(/no files to download/)
  })

  it('declares a Content-Length that matches the bytes it then streams', async () => {
    const built = await archive([candidate({ id: 'f-1' }), candidate({ id: 'f-2' })])
    const bytes = await collect(built.body)

    expect(bytes.length).toBe(built.totalBytes)
    expect(built.fileCount).toBe(2)
  })

  it('folders the archive by the grouping it was given', async () => {
    const files = [
      candidate({ id: 'f-1', sessionLabel: 'SESS-1 One' }),
      candidate({ id: 'f-2', sessionLabel: 'SESS-2 Two', speakerLabel: 'Bo Chen' }),
    ]

    expect(membersOf(await collect((await archive(files, 'session')).body))).toEqual([
      'SESS-1 One/deck.pdf',
      'SESS-2 Two/deck.pdf',
    ])
    expect(membersOf(await collect((await archive(files, 'speaker')).body))).toEqual([
      'Ana Ruiz/deck.pdf',
      'Bo Chen/deck.pdf',
    ])
    expect(membersOf(await collect((await archive(files, 'none')).body))).toEqual([
      'deck.pdf',
      'deck (2).pdf',
    ])
  })

  it('refuses a file owned by a speaker outside the event, before opening anything', async () => {
    opened.length = 0
    const foreign = candidate({
      id: 'f-x',
      objectKey: buildObjectKey(
        { kind: 'slides', speakerId: OUTSIDER, filename: 'deck.pdf' },
        'f-x',
      ),
    })

    await expect(archive([candidate({ id: 'f-1' }), foreign])).rejects.toThrow(
      /this event does not own/,
    )
    expect(opened).toEqual([])
  })

  it('fails with the missing key rather than truncating the archive', async () => {
    const ghost = candidate({ id: 'f-ghost' })
    objects.delete(ghost.objectKey)

    const built = await archive([ghost])
    await expect(collect(built.body)).rejects.toThrow(/missing/)
  })

  it('opens each member only when the writer reaches it', async () => {
    opened.length = 0
    const built = await archive([candidate({ id: 'f-1' }), candidate({ id: 'f-2' })])
    const reader = built.body.getReader()

    await reader.read()
    expect(opened).toHaveLength(0)
    await reader.read()
    expect(opened).toHaveLength(1)
    await reader.cancel()
  })
})

describe('plannedArchive', () => {
  it('agrees with the archive the builder produces', async () => {
    const files = [candidate({ id: 'f-1', body: 'a'.repeat(1000) }), candidate({ id: 'f-2' })]
    const planned = plannedArchive(files, 'session')
    const built = await archive(files)

    expect(planned.totalBytes).toBe((await collect(built.body)).length)
    expect(planned.entries.map((entry) => entry.path)).toEqual([
      'SESS-1 Scaling Postgres/deck.pdf',
      'SESS-1 Scaling Postgres/deck (2).pdf',
    ])
  })
})
