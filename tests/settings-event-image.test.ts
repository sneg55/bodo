// The pure half of an event image upload: which kinds exist, what they accept, where the
// object lands, and which Events column the stored URL belongs on.
//
// The property this file is really about is the object KEY. An event logo is uploaded by an
// organizer, so the prefix cannot be a speaker id, and it must come from the event id the
// route already authorized rather than from anything the caller sent alongside it. That is
// what stops a caller writing into another event's prefix by asking to, and it is asserted
// here rather than through the UI because it is a one-line decision with a security answer.
//
// The authorization decision itself, and the order the bytes and the write happen in, are in
// tests/settings-event-image-upload.test.ts.

import { describe, expect, it } from 'vitest'

import {
  EVENT_IMAGE_ACCEPT,
  EVENT_IMAGE_KINDS,
  eventImageField,
  eventImageKindOf,
} from '@/features/settings/event-images'
import {
  buildObjectKey,
  checkUploadAllowed,
  uploadLimit,
  visibilityFor,
} from '@/services/storage/uploads'

const MB = 1024 * 1024

describe('the object key for an event image', () => {
  it('is prefixed by the kind and the event, not by a speaker', () => {
    const key = buildObjectKey(
      { kind: 'event-logo', eventId: 'recEvt1', filename: 'logo.png' },
      'n1',
    )

    expect(key).toBe('event-logo/recEvt1/n1-logo.png')
  })

  it('ignores a speaker id supplied alongside it', () => {
    // The two owner fields are one shape, so an event-scoped kind has to pick the event and
    // never fall back to whatever else was passed: falling back would key an organizer's
    // upload under a speaker prefix the portal serves.
    const key = buildObjectKey(
      { kind: 'event-logo', eventId: 'recEvt1', speakerId: 'recSpk1', filename: 'logo.png' },
      'n1',
    )

    expect(key).toBe('event-logo/recEvt1/n1-logo.png')
    expect(key).not.toContain('recSpk1')
  })

  it('refuses to build a key with no resolved event id, rather than an empty prefix', () => {
    // An empty segment would put every unowned upload under `event-logo//...`, which is a
    // prefix nobody can purge and nobody owns.
    expect(() => buildObjectKey({ kind: 'event-logo', filename: 'logo.png' }, 'n1')).toThrow(
      /event id/,
    )
    expect(() =>
      buildObjectKey({ kind: 'event-background', eventId: '   ', filename: 'bg.png' }, 'n1'),
    ).toThrow(/event id/)
  })

  it('still keys a speaker kind on the speaker id', () => {
    expect(buildObjectKey({ kind: 'slides', speakerId: 'recSpk1', filename: 'd.pdf' }, 'n1')).toBe(
      'slides/recSpk1/n1-d.pdf',
    )
  })

  it('sanitises the filename on the event branch too', () => {
    const key = buildObjectKey(
      { kind: 'event-background', eventId: 'recEvt1', filename: '../../etc/passwd' },
      'n1',
    )

    expect(key).toBe('event-background/recEvt1/n1-etc-passwd')
    expect(key).not.toContain('..')
  })

  it('never collides on a re-upload of the same filename', () => {
    const base = { kind: 'event-logo', eventId: 'recEvt1', filename: 'logo.png' } as const
    expect(buildObjectKey(base, 'n1')).not.toBe(buildObjectKey(base, 'n2'))
  })
})

describe('what an event image accepts', () => {
  it('takes the three raster image types', () => {
    for (const kind of EVENT_IMAGE_KINDS) {
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        expect(() => checkUploadAllowed(kind, type, 1 * MB)).not.toThrow()
      }
    }
  })

  it('refuses a non-image content type', () => {
    // A logo slot that accepted a PDF would store it publicly under the event's prefix and
    // then render it as a broken image on the settings page and the public agenda.
    for (const type of ['application/pdf', 'text/html', 'application/octet-stream']) {
      expect(() => checkUploadAllowed('event-logo', type, 1 * MB)).toThrow(
        /not accepted for event-logo/,
      )
    }
  })

  it('refuses SVG, which is a script container when served from a public bucket', () => {
    expect(() => checkUploadAllowed('event-background', 'image/svg+xml', 1 * MB)).toThrow(
      /not accepted for event-background/,
    )
  })

  it('caps both kinds well inside the Workers request-body limit', () => {
    for (const kind of EVENT_IMAGE_KINDS) {
      const { maxBytes } = uploadLimit(kind)
      expect(maxBytes).toBeLessThan(100 * MB)
      expect(() => checkUploadAllowed(kind, 'image/png', maxBytes)).not.toThrow()
      expect(() => checkUploadAllowed(kind, 'image/png', maxBytes + 1)).toThrow(/capped at/)
    }
  })

  it('refuses a declared size that is not a positive count of bytes', () => {
    for (const declared of [0, -1, 1.5, Number.NaN]) {
      expect(() => checkUploadAllowed('event-logo', 'image/png', declared)).toThrow(/declared size/)
    }
  })
})

describe('visibility', () => {
  it('publishes both event images, because a logo is read by the public agenda', () => {
    expect(visibilityFor('event-logo')).toBe('public')
    expect(visibilityFor('event-background')).toBe('public')
  })
})

describe('eventImageKindOf', () => {
  it('recognises the two event kinds', () => {
    expect(eventImageKindOf('event-logo')).toBe('event-logo')
    expect(eventImageKindOf('event-background')).toBe('event-background')
    expect(eventImageKindOf(' event-logo ')).toBe('event-logo')
  })

  it('does not claim a speaker kind, so the speaker branch keeps its own guard', () => {
    for (const kind of ['headshot', 'slides', 'doc']) {
      expect(eventImageKindOf(kind)).toBeUndefined()
    }
  })

  it('answers undefined for anything else, including nothing at all', () => {
    expect(eventImageKindOf(null)).toBeUndefined()
    expect(eventImageKindOf('')).toBeUndefined()
    expect(eventImageKindOf('event-logo; drop')).toBeUndefined()
  })
})

describe('eventImageField', () => {
  it('maps each kind to the column the settings page reads', () => {
    expect(eventImageField('event-logo')).toBe('logoUrl')
    expect(eventImageField('event-background')).toBe('backgroundUrl')
  })
})

describe('the accept attribute the picker offers', () => {
  it('cannot drift from what the server will take', () => {
    // The file dialog is a convenience; the server list is the rule. If they disagree the
    // organizer picks a file and gets a 415 for no visible reason.
    for (const kind of EVENT_IMAGE_KINDS) {
      expect(EVENT_IMAGE_ACCEPT.split(',')).toEqual([...uploadLimit(kind).types])
    }
  })
})
