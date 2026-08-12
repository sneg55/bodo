// Is rich text empty? The write side and the render side must give the same answer, and the
// answer must not be "yes" for a body a reader can plainly see.
//
// Why this file exists. The rule started as one regex, stripping tags and testing what was
// left, copied into `text.ts` and again into `OrganizerHtml.tsx`. That was correct for as long
// as the editor could only produce text. The moment the toolbar gained an image button it
// became a silent data-loss path: a welcome message containing exactly one image stripped to
// the empty string, so `blankToUndefined` stored `undefined` and the render guard drew nothing.
// Nothing threw and nothing was logged. Found by the two build agents independently, one at
// each end of the round trip.

import { describe, expect, it } from 'vitest'
import { isBlankRichText, VISIBLE_VOID_TAGS } from '@/features/forms/builder/emptiness'
import { blankToUndefined, trimToUndefined } from '@/features/forms/builder/text'

const IMG = '<img src="https://cdn.example.com/banner.png">'

describe('isBlankRichText', () => {
  it('treats an image-only body as content, which is the bug this exists for', () => {
    expect(isBlankRichText(IMG)).toBe(false)
    expect(isBlankRichText(`<p>${IMG}</p>`)).toBe(false)
    // The regression in the exact shape it shipped: through the write boundary, an
    // image-only body used to become `undefined` and the image was gone on the next load.
    expect(blankToUndefined(`<p>${IMG}</p>`)).toBe(`<p>${IMG}</p>`)
  })

  it('treats a horizontal rule as content too', () => {
    // A divider is the other thing this editor can insert that has no text in it. Listing it
    // is cheap; discovering it the same way as the image would not have been.
    expect(isBlankRichText('<p></p><hr><p></p>')).toBe(false)
  })

  it('still counts every shape of a cleared editor as empty', () => {
    // These are what TipTap actually leaves behind, and the reason the rule cannot just be
    // `value.length === 0`. Each of these used to reach the column as stored markup and
    // suppressed the wizard's own default copy.
    for (const cleared of ['', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<p>\n</p>']) {
      expect(isBlankRichText(cleared)).toBe(true)
      expect(blankToUndefined(cleared)).toBeUndefined()
    }
  })

  it('is not fooled by a tag whose NAME merely starts with a visible one', () => {
    // `<image>` and `<hrefish>` are not `<img>` and `<hr>`. Without the word boundary in the
    // pattern, a made-up tag would count as content and an empty paragraph would render.
    expect(isBlankRichText('<p><image></image></p>')).toBe(true)
    expect(isBlankRichText('<hrefish></hrefish>')).toBe(true)
  })

  it('matches an image however the markup is spaced or cased', () => {
    // Stored markup is not always what the editor wrote: it can be hand-edited in Airtable,
    // or come from a paste. A case-sensitive test would drop a pasted `<IMG>`.
    expect(isBlankRichText('<IMG SRC="x.png">')).toBe(false)
    expect(isBlankRichText('< img src="x.png">')).toBe(false)
    expect(isBlankRichText('<img\nsrc="x.png">')).toBe(false)
  })

  it('keeps the exported tag list in step with the pattern it documents', () => {
    // The list is a second statement of the same fact, so it can rot. Asserting each entry
    // really is treated as visible is what stops the doc comment from lying.
    for (const tag of VISIBLE_VOID_TAGS) {
      expect(isBlankRichText(`<p><${tag}></p>`)).toBe(false)
    }
  })

  it('leaves the plain-text helper alone, which trims where the markup one must not', () => {
    // `trimToUndefined` is for a one-line heading and DOES trim. Routing it through the
    // rich-text rule would have made `  <img>  ` a heading, which is nonsense.
    expect(trimToUndefined('  Welcome  ')).toBe('Welcome')
    expect(trimToUndefined('   ')).toBeUndefined()
  })
})
