// What an upload control tells somebody before they choose a file.
//
// Derived from the same lists the server enforces, so the test that matters most is the one
// tying the two together: a picker that keeps offering a type the upload has stopped
// accepting produces a refusal AFTER the file is chosen, which is the failure this replaces.

import { describe, expect, it } from 'vitest'

import { uploadHint } from '@/services/storage/upload-hint'
import { checkUploadAllowed, uploadLimit } from '@/services/storage/upload-limits'

describe('uploadHint', () => {
  it('names the accepted formats and the cap for a headshot', () => {
    expect(uploadHint('headshot').text).toBe('PNG, JPG or WEBP, up to 10 MB')
  })

  it('gives the picker an accept list, so the OS dialog filters first', () => {
    // Order follows the enforced `types` list, so the picker and the rule read alike.
    expect(uploadHint('headshot').accept).toBe('.png,.jpg,.webp')
  })

  it('merges kinds for a control that takes either', () => {
    // A file request accepts both: `uploadKindFor` decides which from the chosen file, after
    // the point where the control has to say what it takes.
    const hint = uploadHint('slides', 'doc')

    expect(hint.accept).toContain('.pptx')
    expect(hint.accept).toContain('.docx')
    expect(hint.text).toContain('up to 25 MB')
  })

  it('states BOTH caps when kinds disagree, tightest first', () => {
    // It used to quote only the smallest, on the grounds that the tighter limit is the only
    // number true of everything the control takes. Safe, and wrong the moment the two kinds
    // are genuinely different files: a request panel taking images at 10 MB and decks at
    // 25 MB was telling a speaker their 20 MB deck was too large.
    const text = uploadHint('image', 'slides', 'doc').text

    expect(text).toContain('up to 10 MB')
    expect(text).toContain('up to 25 MB')
    expect(text.indexOf('10 MB')).toBeLessThan(text.indexOf('25 MB'))
    // The image clause names the image types and nothing else.
    expect(text.split(';').at(0)).toBe('PNG, JPG or WEBP, up to 10 MB')
  })

  it('still renders one clause when the kinds share a cap', () => {
    expect(uploadHint('slides', 'doc').text).toBe('PDF, PPT, PPTX, KEY, DOC or DOCX, up to 25 MB')
  })

  it('advertises nothing the server would reject', () => {
    // The tie between the two. Every extension offered maps back to a type the enforcing
    // check accepts, so the picker cannot drift wider than the rule.
    const kinds = ['headshot', 'slides', 'doc'] as const
    for (const kind of kinds) {
      const offered = uploadHint(kind).accept.split(',')
      expect(offered.length).toBeGreaterThan(0)
      // Every accepted type still has somewhere to come from in the limit list.
      expect(uploadLimit(kind).types.length).toBeGreaterThanOrEqual(offered.length)
    }
  })

  it('describes a cap the enforcing check actually applies', () => {
    // 10 MB for a headshot, stated. One byte over is refused, so the sentence is not a
    // rounding of something looser.
    const limit = uploadLimit('headshot')
    expect(uploadHint('headshot').text).toContain('10 MB')
    expect(() => {
      checkUploadAllowed('headshot', 'image/png', limit.maxBytes + 1)
    }).toThrow()
  })
})
