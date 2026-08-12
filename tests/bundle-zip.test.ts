// The archive writer's checksum and byte layout.
//
// The companion suite (bundle-zip-unzip.test.ts) proves a real Info-ZIP opens the result,
// which is the check that matters: a test that only re-parses the writer's own output
// cannot catch a consistent misunderstanding of the format, because such a test agrees
// with the mistake twice. What this file adds is the part `unzip` cannot report, namely
// that the central directory's offsets point where the reader is told they do, and the
// published CRC-32 check value.

import { describe, expect, it } from 'vitest'

import {
  assertClassicZipFits,
  crc32,
  storedArchiveSize,
  type ZipSource,
  zipArchiveStream,
} from '@/utils/zip'
import {
  CENTRAL_HEADER_BYTES,
  CENTRAL_SIG,
  DESCRIPTOR_BYTES,
  DESCRIPTOR_SIG,
  EOCD_BYTES,
  EOCD_SIG,
  FLAGS,
  LOCAL_HEADER_BYTES,
  LOCAL_SIG,
} from '@/utils/zip-records'
import { build, source, TEXT } from './bundle-zip-fixtures'

describe('crc32', () => {
  it('matches the published check value for "123456789"', () => {
    expect(crc32(TEXT.encode('123456789'))).toBe(0xcbf4_3926)
  })

  it('is zero for no bytes', () => {
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('resumes across chunks, which is what the data descriptor depends on', () => {
    const whole = TEXT.encode('the quick brown fox jumps over the lazy dog')
    const seeded = crc32(whole.slice(0, 11), crc32(new Uint8Array()))
    expect(crc32(whole.slice(11), seeded)).toBe(crc32(whole))
  })

  it('stays inside 32 unsigned bits for input that flips the high bit', () => {
    const value = crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(0xffff_ffff)
  })
})

describe('storedArchiveSize', () => {
  it('is the end-of-central-directory record alone for no members', () => {
    expect(storedArchiveSize([])).toBe(EOCD_BYTES)
  })

  it('predicts the byte length the writer actually produces', async () => {
    const archive = await build([
      source('Session A/deck.pdf', 'hello'),
      source('Session B/notes.pdf', 'x'.repeat(2048)),
      source('flat.png', ''),
    ])

    expect(
      storedArchiveSize([
        { path: 'Session A/deck.pdf', size: 5 },
        { path: 'Session B/notes.pdf', size: 2048 },
        { path: 'flat.png', size: 0 },
      ]),
    ).toBe(archive.length)
  })

  it('counts a multi-byte name by its UTF-8 length, not its character count', () => {
    expect(storedArchiveSize([{ path: 'é', size: 0 }])).toBe(
      storedArchiveSize([{ path: 'ab', size: 0 }]),
    )
  })
})

describe('zipArchiveStream layout', () => {
  it('writes an empty but valid archive when there is nothing to include', async () => {
    const archive = await build([])
    expect(archive.length).toBe(EOCD_BYTES)
    expect(new DataView(archive.buffer).getUint32(0, true)).toBe(EOCD_SIG)
  })

  it('starts every member with a local header carrying the streaming flags', async () => {
    const archive = await build([source('a.txt', 'aa')])
    const view = new DataView(archive.buffer)

    expect(view.getUint32(0, true)).toBe(LOCAL_SIG)
    expect(view.getUint16(6, true)).toBe(FLAGS)
    // Compression method 0 is STORE.
    expect(view.getUint16(8, true)).toBe(0)
    // CRC and both sizes are deferred to the descriptor, so the header holds zeroes.
    expect(view.getUint32(14, true)).toBe(0)
    expect(view.getUint32(18, true)).toBe(0)
    expect(view.getUint32(22, true)).toBe(0)
  })

  it('follows the member bytes with a data descriptor holding the real crc and size', async () => {
    const body = 'streamed in pieces'
    const archive = await build([source('a.txt', body, 4)])
    const view = new DataView(archive.buffer)
    const at = LOCAL_HEADER_BYTES + 'a.txt'.length + body.length

    expect(view.getUint32(at, true)).toBe(DESCRIPTOR_SIG)
    expect(view.getUint32(at + 4, true)).toBe(crc32(TEXT.encode(body)))
    expect(view.getUint32(at + 8, true)).toBe(body.length)
    expect(view.getUint32(at + 12, true)).toBe(body.length)
  })

  it('accounts for the descriptor in the offset of the next member', async () => {
    const first = 'first body'
    const archive = await build([source('one.txt', first), source('two.txt', 'second')])
    const expected = LOCAL_HEADER_BYTES + 'one.txt'.length + first.length + DESCRIPTOR_BYTES

    expect(new DataView(archive.buffer).getUint32(expected, true)).toBe(LOCAL_SIG)
  })

  it('parses back a central directory whose offsets point at real local headers', async () => {
    const bodies = new Map([
      ['first/one.txt', 'one'],
      ['first/two.txt', 'two-two'],
      ['second/three.txt', ''],
    ])
    const archive = await build([...bodies].map(([path, body]) => source(path, body)))
    const view = new DataView(archive.buffer)

    const eocdAt = archive.length - EOCD_BYTES
    expect(view.getUint32(eocdAt, true)).toBe(EOCD_SIG)
    expect(view.getUint16(eocdAt + 10, true)).toBe(bodies.size)
    const directorySize = view.getUint32(eocdAt + 12, true)
    const directoryAt = view.getUint32(eocdAt + 16, true)
    expect(directoryAt + directorySize).toBe(eocdAt)

    let at = directoryAt
    for (const [path, body] of bodies) {
      expect(view.getUint32(at, true)).toBe(CENTRAL_SIG)
      const nameLength = view.getUint16(at + 28, true)
      expect(new TextDecoder().decode(archive.slice(at + 46, at + 46 + nameLength))).toBe(path)
      expect(view.getUint32(at + 16, true)).toBe(crc32(TEXT.encode(body)))
      expect(view.getUint32(at + 20, true)).toBe(body.length)
      expect(view.getUint32(at + 24, true)).toBe(body.length)

      // The offset the reader is told to seek to has to hold a local header for this name.
      const headerAt = view.getUint32(at + 42, true)
      expect(view.getUint32(headerAt, true)).toBe(LOCAL_SIG)
      expect(view.getUint16(headerAt + 26, true)).toBe(nameLength)

      at += CENTRAL_HEADER_BYTES + nameLength
    }
    expect(at).toBe(eocdAt)
  })

  it('refuses a selection with more members than the format can index', async () => {
    const many = Array.from({ length: 65_536 }, (_unused, index) => source(`f${String(index)}`, ''))
    await expect(build(many)).rejects.toThrow(/65535/)
  })

  it('does not open a member until the writer reaches it', async () => {
    const opened: string[] = []
    const lazy = (path: string): ZipSource => ({
      path,
      open: () => {
        opened.push(path)
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close()
            },
          }),
        )
      },
    })

    const reader = zipArchiveStream([lazy('a'), lazy('b')]).getReader()
    // The first pull yields the first local header, which is emitted before `open` runs.
    await reader.read()
    expect(opened).toEqual([])
    await reader.read()
    expect(opened).toEqual(['a'])
    await reader.cancel()
  })
})

describe('assertClassicZipFits, the preflight', () => {
  // The writer checks these two limits as it goes, and that was not enough: those checks run
  // inside the generator, which only advances as the CONSUMER reads the response body, so the
  // route had already answered 200 with a Content-Length and streamed most of the archive before
  // the throw. What arrived was a truncated file with no central directory, which no reader can
  // open and which reports nothing to the caller. Both numbers are arithmetic, so the answer is a
  // refusal before the first byte. Found by Codex review.
  it('passes an ordinary selection', () => {
    expect(assertClassicZipFits(50, 500_000_000)).toEqual({ ok: true })
  })

  it('passes an empty archive, which the caller refuses for its own reasons', () => {
    expect(assertClassicZipFits(0, 22)).toEqual({ ok: true })
  })

  it('refuses more members than the 16-bit member count can hold', () => {
    expect(assertClassicZipFits(65_535, 1000)).toEqual({ ok: true })
    expect(assertClassicZipFits(65_536, 1000).ok).toBe(false)
  })

  it('refuses a total no 32-bit offset field can address', () => {
    expect(assertClassicZipFits(1, 0xffff_ffff)).toEqual({ ok: true })
    expect(assertClassicZipFits(1, 0x1_0000_0000).ok).toBe(false)
  })

  it('gives a reason written for the organizer, not a field name', () => {
    const refused = assertClassicZipFits(1, 0x1_0000_0000)

    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toContain('smaller selection')
  })
})
