// The image node's parse rule: which `src` values may enter the document at all.
//
// Split out of `rich-text-round-trip.test.ts` because that file hit the 300-line hook limit.
// The concern is genuinely separate anyway: the round-trip file asks "does what the editor wrote
// survive a reload", and this one asks "what is the editor willing to accept in the first place".

import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { richTextExtensions } from '@/components/primitives/rich-text-extensions'

const schema = getSchema(richTextExtensions())

describe('the image parse rule', () => {
  it('refuses a pasted image whose src is not http or https', () => {
    // This used to assert the parse rule's SELECTOR string, `img[src]:not([src^="data:"])`,
    // which came free with `allowBase64: false`. Codex review pointed out that selector was the
    // only restriction, so a pasted or dropped `<img>` could keep a relative or `javascript:`
    // src while the button's own guard applied to typed URLs only: the comments claimed a
    // policy the editor did not enforce. The rule now carries a `getAttrs` predicate sharing
    // `safeHttpUrl` with the button, so this asserts the BEHAVIOUR instead of the string, which
    // is what it should have done in the first place.
    const rule = schema.nodes.image.spec.parseDOM?.at(0)
    const attrsFor = (src: string) =>
      rule?.getAttrs?.({ getAttribute: () => src } as unknown as HTMLElement)

    // `false` is ProseMirror's "this rule does not match", so the node is not created.
    for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', '/rel.png']) {
      expect(attrsFor(bad), `${bad} must not parse`).toBe(false)
    }
    // Anything OTHER than `false` is the accept case. Asserting `null` specifically would be
    // asserting the wrong thing: TipTap merges the Image extension's own per-attribute parsing
    // into the result, so the rule returning `null` still yields an attribute object here.
    expect(attrsFor('https://cdn.example.com/a.png')).not.toBe(false)
  })
})
