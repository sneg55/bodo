// The client and the server have to agree about what an upload KIND is.
//
// They did not, and it cost the portal every image upload. `uploadKindFor` classifies PNG,
// JPEG and WEBP as `image`, deliberately rather than as `headshot`, so a photo answering a file
// request cannot overwrite the speaker's profile picture. Nothing downstream was ever taught
// the kind: the upload route's `KINDS` did not list it, so every such upload came back HTTP 415
// with "kind must be one of headshot, slides, doc", and `uploadScopeFor` had no entry for it
// either, so it would have thrown one step later. The widget's own constraint line advertised
// "PNG, JPG or WEBP" the whole time, and its `accept` attribute offered them.
//
// Reproduced end to end by the 2026-08-12 eval run and then at the API with curl. These are the
// three couplings that were broken, asserted over the WHOLE set the classifier can produce, so
// a fourth kind cannot be half-landed the same way.

import { describe, expect, it } from 'vitest'

import { KINDS } from '@/app/api/files/upload/speaker-upload'
import { uploadKindFor } from '@/features/portal/upload-client'
import { uploadLimit, uploadScopeFor, visibilityFor } from '@/services/storage/upload-limits'

/** Every content type the portal's own hint and `accept` list offer a speaker. */
const OFFERED = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-iwork-keynote-sffkey',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

describe('the kinds the portal hands out', () => {
  it('are all accepted by the upload route', () => {
    const refused = OFFERED.map(uploadKindFor).filter(
      (kind) => !KINDS.some((accepted) => accepted === kind),
    )

    expect(refused).toEqual([])
  })

  it('classifies a photograph as image, not as headshot', () => {
    // The distinction is the point: `kind === 'headshot'` is what makes the route write the
    // object's URL onto the Speakers record.
    expect(uploadKindFor('image/png')).toBe('image')
  })

  it('all have a storage scope, a size cap and a visibility', () => {
    for (const contentType of OFFERED) {
      const kind = uploadKindFor(contentType)
      expect(() => uploadScopeFor(kind)).not.toThrow()
      expect(uploadLimit(kind).maxBytes).toBeGreaterThan(0)
      expect(['public', 'private']).toContain(visibilityFor(kind))
    }
  })

  it('keeps an answered file request private', () => {
    // A headshot is public because every avatar read points at it. An image answering a file
    // request is not an avatar and must not become world-readable by sharing its plumbing.
    expect(visibilityFor('image')).toBe('private')
    expect(visibilityFor('headshot')).toBe('public')
  })

  it('accepts every offered content type within its own kind cap', () => {
    for (const contentType of OFFERED) {
      const kind = uploadKindFor(contentType)
      expect(uploadLimit(kind).types).toContain(contentType)
    }
  })
})
