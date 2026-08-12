// The pure half of the upload service: what is allowed in, and what key it lands
// under. `putObject` and its verify-after-write step are in tests/uploads-put.test.ts.

import { describe, expect, it } from 'vitest'

import {
  buildObjectKey,
  checkUploadAllowed,
  uploadLimit,
  visibilityFor,
} from '@/services/storage/uploads'

const MB = 1024 * 1024

describe('checkUploadAllowed', () => {
  it('accepts a headshot inside the cap', () => {
    expect(() => checkUploadAllowed('headshot', 'image/png', 2 * MB)).not.toThrow()
  })

  it('rejects a type that is not on the list for that kind', () => {
    // A PDF is fine as a document and wrong as a headshot. The cap is per kind,
    // not global, so this has to be checked against the right list.
    expect(() => checkUploadAllowed('headshot', 'application/pdf', 1 * MB)).toThrow(
      /not accepted for headshot/,
    )
  })

  it('rejects an oversized upload before any bytes are written', () => {
    expect(() => checkUploadAllowed('slides', 'application/pdf', 40 * MB)).toThrow(
      /capped at 25 MB/,
    )
  })

  it('treats the cap as inclusive', () => {
    const { maxBytes } = uploadLimit('slides')
    expect(() => checkUploadAllowed('slides', 'application/pdf', maxBytes)).not.toThrow()
    expect(() => checkUploadAllowed('slides', 'application/pdf', maxBytes + 1)).toThrow()
  })

  it('rejects a declared size that is not a positive count of bytes', () => {
    // Content-Length arrives from the client, so it is an assertion and not a
    // fact. Only the upper bound used to be checked, which let 0, -1, 1.5, and
    // NaN through: each of those then compared as "not greater than the cap" and
    // sailed into the write.
    for (const declared of [0, -1, -1 * MB, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => checkUploadAllowed('slides', 'application/pdf', declared)).toThrow(
        /declared size/,
      )
    }
  })

  it('accepts the smallest real upload, one byte', () => {
    expect(() => checkUploadAllowed('slides', 'application/pdf', 1)).not.toThrow()
  })

  it('keeps document uploads well under the Workers request-body limit', () => {
    // The reason the cap is 25 MB and not 100 MB: a proxied body is bounded by
    // Cloudflare's own limit, so the cap needs headroom rather than sitting on it.
    for (const kind of ['headshot', 'slides', 'doc'] as const) {
      expect(uploadLimit(kind).maxBytes).toBeLessThan(100 * MB)
    }
  })
})

describe('visibilityFor', () => {
  it('publishes headshots and keeps everything else private', () => {
    expect(visibilityFor('headshot')).toBe('public')
    expect(visibilityFor('slides')).toBe('private')
    expect(visibilityFor('doc')).toBe('private')
  })
})

describe('buildObjectKey', () => {
  const base = { kind: 'slides', speakerId: 'recSpk1' } as const

  it('namespaces by kind and owner so a per-speaker purge is a prefix delete', () => {
    const key = buildObjectKey({ ...base, filename: 'deck.pdf' }, 'n1')
    expect(key).toBe('slides/recSpk1/n1-deck.pdf')
  })

  it('never collides on a re-upload of the same filename', () => {
    // A Files row already points at the old key, so overwriting would silently
    // change what an existing record resolves to.
    const first = buildObjectKey({ ...base, filename: 'deck.pdf' }, 'n1')
    const second = buildObjectKey({ ...base, filename: 'deck.pdf' }, 'n2')
    expect(first).not.toBe(second)
  })

  it('strips path separators out of a browser-supplied filename', () => {
    const key = buildObjectKey({ ...base, filename: '../../etc/passwd' }, 'n1')
    expect(key).toBe('slides/recSpk1/n1-etc-passwd')
    expect(key).not.toContain('..')
  })

  it('strips leading dots so nothing becomes a hidden object', () => {
    const key = buildObjectKey({ ...base, filename: '.env' }, 'n1')
    expect(key).toBe('slides/recSpk1/n1-env')
  })

  it('survives a filename that sanitises to nothing', () => {
    const key = buildObjectKey({ ...base, filename: '???' }, 'n1')
    expect(key).toBe('slides/recSpk1/n1-file')
  })

  it('caps a pathological filename length', () => {
    const key = buildObjectKey({ ...base, filename: `${'a'.repeat(500)}.pdf` }, 'n1')
    expect(key.length).toBeLessThan(200)
  })

  it('keeps non-ASCII names usable rather than empty', () => {
    const key = buildObjectKey({ ...base, filename: 'präsentation.pdf' }, 'n1')
    expect(key.startsWith('slides/recSpk1/n1-')).toBe(true)
    expect(key.endsWith('.pdf')).toBe(true)
  })
})
