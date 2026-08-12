// The extension set behind the shared rich text editor, in one place so a test can build
// the same ProseMirror schema the editor runs on.
//
// That is the point of the split: `getSchema()` needs no DOM, so the schema this returns
// can be asserted in `environment: 'node'` (tests/rich-text-round-trip.test.ts), and the
// thing worth asserting is that every toolbar button has a schema behind it. A missing
// mark does not fail loudly, it silently drops tags on the next parse: `<sup>` typed into
// a welcome message comes back as plain text the first time the form is reopened.

import Image from '@tiptap/extension-image'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'

import { safeHttpUrl } from '@/components/primitives/rich-text-html'
import { BlockIndent } from '@/components/primitives/rich-text-indent'

/** The default placeholder, transcribed from the reference (`Enter text here...`). */
export const RICH_TEXT_PLACEHOLDER = 'Enter text here...'

export function richTextExtensions(placeholder: string = RICH_TEXT_PLACEHOLDER) {
  return [
    StarterKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    // The two marks behind the x² and x₂ buttons. Without them `<sup>` and `<sub>` are not
    // in the schema, so reopening a saved form would parse the tags away.
    Superscript,
    Subscript,
    // `allowBase64` off keeps a `data:` payload out, but that was the ONLY restriction here,
    // so a pasted or dropped `<img>` could keep a relative or otherwise non-http src while the
    // button's `safeHttpUrl` guard applied to typed URLs only. Codex review pointed out the
    // comments therefore claimed a policy the editor did not enforce. `parseHTML` now applies
    // the same predicate on the way IN, so paste, drop and button agree.
    //
    // This is defence in depth and not the last line: `safeRichHtml` sanitizes at every render
    // sink, because a value written straight into Airtable never passes through this editor.
    Image.extend({
      parseHTML: () => [
        {
          tag: 'img[src]',
          getAttrs: (element) => {
            const src = typeof element === 'string' ? element : element.getAttribute('src')
            return safeHttpUrl(src ?? '') === undefined ? false : null
          },
        },
      ],
    }).configure({ allowBase64: false }),
    // Indent and outdent for blocks that are not list items. Local, because there is no
    // official indent extension; see rich-text-indent.ts.
    BlockIndent,
    // A real extension rather than a CSS `:empty` trick: ProseMirror always keeps an empty
    // paragraph in the document, so the node is never actually empty.
    Placeholder.configure({ placeholder }),
  ]
}
