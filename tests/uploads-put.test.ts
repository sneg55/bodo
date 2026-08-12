// `putObject` is the write half of the upload service, and its verify-after-write
// step is the only reason a Files row can be trusted. These tests drive it against
// a fake bucket, because the interesting cases are all disagreements between what
// the client declared and what R2 actually stored, and those are unreachable
// through a real happy-path upload.

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BucketLike } from '@/utils/cf'

const MB = 1024 * 1024

type HeadResult = { size: number; httpMetadata?: { contentType?: string } } | null

/**
 * Stands in for the R2 binding. The body is ignored on purpose: what `head`
 * returns is the test's way of saying what the bucket really ended up with, which
 * is the whole thing under test.
 */
class FakeBucket implements BucketLike {
  readonly puts: { key: string; contentType: unknown }[] = []
  readonly deletes: string[] = []

  constructor(
    private readonly headResult: HeadResult,
    private readonly deleteError?: Error,
  ) {}

  put(key: string, _value: ReadableStream | ArrayBuffer, options?: unknown): Promise<unknown> {
    const meta = options as { httpMetadata?: { contentType?: string } } | undefined
    this.puts.push({ key, contentType: meta?.httpMetadata?.contentType })
    return Promise.resolve(undefined)
  }

  get(): Promise<{ body: ReadableStream } | null> {
    return Promise.resolve(null)
  }

  head(): Promise<HeadResult> {
    return Promise.resolve(this.headResult)
  }

  delete(key: string): Promise<void> {
    this.deletes.push(key)
    if (this.deleteError !== undefined) return Promise.reject(this.deleteError)
    return Promise.resolve()
  }
}

/** Empty on purpose: the fake bucket never reads it. */
function emptyBody(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function slidesRequest(declaredBytes: number, contentType = 'application/pdf') {
  return {
    kind: 'slides' as const,
    speakerId: 'recSpk1',
    filename: 'deck.pdf',
    contentType,
    declaredBytes,
    body: emptyBody(),
  }
}

async function loadUploads(
  bucket: BucketLike,
): Promise<typeof import('@/services/storage/uploads')> {
  vi.resetModules()
  vi.doMock('@/utils/cf', () => ({ getUploadBucket: () => Promise.resolve(bucket) }))
  return await import('@/services/storage/uploads')
}

/**
 * The thrown AppError's id, read off the object rather than through `isAppError`.
 * `vi.resetModules()` gives the reloaded uploads.ts its own copy of errorIds, so
 * the class identity differs from this file's and `instanceof` would be false
 * even for a genuine AppError.
 */
async function idOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return (error as { id: unknown }).id
  }
  throw new Error('expected putObject to reject')
}

afterEach(() => {
  vi.doUnmock('@/utils/cf')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('putObject, verified write', () => {
  it('returns the stored object when the bytes match the declaration', async () => {
    const bucket = new FakeBucket({
      size: 2 * MB,
      httpMetadata: { contentType: 'application/pdf' },
    })
    const { putObject } = await loadUploads(bucket)

    const stored = await putObject(slidesRequest(2 * MB), 'n1')

    expect(stored).toEqual({
      objectKey: 'slides/recSpk1/n1-deck.pdf',
      visibility: 'private',
      contentType: 'application/pdf',
      size: 2 * MB,
    })
    expect(bucket.puts).toEqual([
      { key: 'slides/recSpk1/n1-deck.pdf', contentType: 'application/pdf' },
    ])
    expect(bucket.deletes).toEqual([])
  })

  it('accepts a bucket that does not echo httpMetadata back on head', async () => {
    // Absent metadata is not evidence of tampering, so the declared type stands.
    const bucket = new FakeBucket({ size: 100 })
    const { putObject } = await loadUploads(bucket)

    const stored = await putObject(slidesRequest(100), 'n1')

    expect(stored.contentType).toBe('application/pdf')
  })
})

describe('putObject, size verification', () => {
  it('rejects a truncated stream instead of recording a file nobody can open', async () => {
    // The case that made the old check useless: 1 MB declared, 12 bytes stored,
    // under the cap, object present. Everything the old code looked at passed.
    const bucket = new FakeBucket({ size: 12, httpMetadata: { contentType: 'application/pdf' } })
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(1 * MB), 'n1'))).toBe('E_FILE_003')
    expect(bucket.deletes).toEqual(['slides/recSpk1/n1-deck.pdf'])
  })

  it('rejects a stored object larger than the declaration', async () => {
    const bucket = new FakeBucket({
      size: 3 * MB,
      httpMetadata: { contentType: 'application/pdf' },
    })
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(2 * MB), 'n1'))).toBe('E_FILE_003')
    expect(bucket.deletes).toEqual(['slides/recSpk1/n1-deck.pdf'])
  })

  it('reports an over-cap stored object as too large rather than as a mismatch', async () => {
    const bucket = new FakeBucket({
      size: 40 * MB,
      httpMetadata: { contentType: 'application/pdf' },
    })
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(20 * MB), 'n1'))).toBe('E_FILE_001')
    expect(bucket.deletes).toEqual(['slides/recSpk1/n1-deck.pdf'])
  })

  it('throws when the object is not there after the write', async () => {
    const bucket = new FakeBucket(null)
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(2 * MB), 'n1'))).toBe('E_FILE_003')
    // Nothing to clean up: head says there is no object under that key.
    expect(bucket.deletes).toEqual([])
  })
})

describe('putObject, type verification', () => {
  it('rejects and deletes when the stored type contradicts the accepted one', async () => {
    const bucket = new FakeBucket({
      size: 2 * MB,
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(2 * MB), 'n1'))).toBe('E_FILE_002')
    expect(bucket.deletes).toEqual(['slides/recSpk1/n1-deck.pdf'])
  })

  it('rejects a stored type that is accepted for the kind but not what was declared', async () => {
    // Both are on the headshot list, so a list membership check alone would pass
    // this and hand back a StoredObject describing the wrong file.
    const bucket = new FakeBucket({ size: 500, httpMetadata: { contentType: 'image/jpeg' } })
    const { putObject } = await loadUploads(bucket)

    const request = {
      kind: 'headshot' as const,
      speakerId: 'recSpk1',
      filename: 'me.png',
      contentType: 'image/png',
      declaredBytes: 500,
      body: emptyBody(),
    }

    expect(await idOf(() => putObject(request, 'n1'))).toBe('E_FILE_002')
    expect(bucket.deletes).toEqual(['headshot/recSpk1/n1-me.png'])
  })
})

describe('putObject, cleanup', () => {
  it('surfaces the verification failure even when the cleanup delete fails', async () => {
    // A failed delete leaves an orphan, which is a storage bill. Replacing the
    // verification error with it would be a lie told to the caller.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bucket = new FakeBucket({ size: 12 }, new Error('r2 unavailable'))
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(1 * MB), 'n1'))).toBe('E_FILE_003')
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('slides/recSpk1/n1-deck.pdf')
  })

  it('writes nothing at all when the declared size is not a byte count', async () => {
    const bucket = new FakeBucket({ size: 10 })
    const { putObject } = await loadUploads(bucket)

    expect(await idOf(() => putObject(slidesRequest(Number.NaN), 'n1'))).toBe('E_FILE_003')
    expect(bucket.puts).toEqual([])
  })
})

describe('putObject, stream length', () => {
  // R2 refuses a stream whose length it cannot see, and by the time an OpenNext route handler
  // passes `request.body` along, workerd no longer sees one. Reproduced on cf:preview as
  // `TypeError: Provided readable stream must have a known length ...`, which failed every
  // upload with a bare 500. `FixedLengthStream` is the fix; these assert both halves of it.
  class FakeFixedLengthStream {
    static lengths: number[] = []
    readonly readable: ReadableStream
    readonly writable: WritableStream

    constructor(length: number) {
      FakeFixedLengthStream.lengths.push(length)
      const { readable, writable } = new TransformStream()
      this.readable = readable
      this.writable = writable
    }
  }

  /** Records what reached `put`, which is the thing under test here. */
  class RecordingBucket extends FakeBucket {
    values: unknown[] = []

    constructor() {
      super({ size: 2 * MB, httpMetadata: { contentType: 'application/pdf' } })
    }

    override put(
      key: string,
      value: ReadableStream | ArrayBuffer,
      options?: unknown,
    ): Promise<unknown> {
      this.values.push(value)
      return super.put(key, value, options)
    }
  }

  it('wraps the body in a FixedLengthStream sized to the declared bytes', async () => {
    FakeFixedLengthStream.lengths = []
    vi.stubGlobal('FixedLengthStream', FakeFixedLengthStream)
    const bucket = new RecordingBucket()
    const { putObject } = await loadUploads(bucket)

    const request = slidesRequest(2 * MB)
    await putObject(request, 'n1')

    expect(FakeFixedLengthStream.lengths).toEqual([2 * MB])
    // The wrapper's readable half, not the request body, is what R2 receives.
    expect(bucket.values[0]).not.toBe(request.body)
  })

  it('passes the body through unchanged on a runtime with no such global', async () => {
    vi.stubGlobal('FixedLengthStream', undefined)
    const bucket = new RecordingBucket()
    const { putObject } = await loadUploads(bucket)

    const request = slidesRequest(2 * MB)
    await putObject(request, 'n1')

    expect(bucket.values[0]).toBe(request.body)
  })
})
