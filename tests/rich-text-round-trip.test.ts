// The rich text editor's save-and-reload round trip.
//
// Five toolbar buttons were added at once (superscript, subscript, outdent, indent,
// image), and all five fail the same silent way: the button toggles, the organizer saves,
// and the mark is gone the next time the form is opened, because the extension that parses
// the tag back was never registered or because the attribute is serialised in a form the
// parse rule does not recognise. Nothing throws. The stored HTML is simply poorer than
// what was typed.
//
// This project has NO DOM test environment (`vitest.config.mts` sets `environment: 'node'`
// and jsdom is not a dependency), so the round trip is asserted where it can be: the
// ProseMirror schema, which `getSchema` builds without touching `document`, plus the pure
// serialisation helpers, plus the real storage boundary in the builder draft. What is
// deliberately NOT claimed here is a browser-level `getHTML()` string comparison; the
// per-node pairing of "the tag it writes" with "the tag it parses" is the DOM-free
// equivalent.
//
// The last group is the one that must not regress: `blankToUndefined` treats a cleared editor
// (`<p></p>`) as absent, via the shared rule in `src/features/forms/builder/emptiness.ts`.
// Adding marks must not change that, and adding a VOID node must not be caught by it, which is
// the distinction that rule now draws.

import { getSchema } from '@tiptap/core'
import { type MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { richTextExtensions } from '@/components/primitives/rich-text-extensions'
import {
  clampIndent,
  indentLevelFromStyle,
  indentStyle,
  MAX_INDENT_LEVEL,
  safeHttpUrl,
} from '@/components/primitives/rich-text-html'
import { draftFromForm, toFormWrite } from '@/features/forms/builder/draft'
import { CFP_FORM } from './helpers/cfp-form'

const ZONE = 'America/Los_Angeles'

const schema = getSchema(richTextExtensions())

/** Superscript, subscript, a nested list, an indented paragraph, and an image. */
const RICH_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'E = mc' },
        { type: 'text', marks: [{ type: 'superscript' }], text: '2' },
        { type: 'text', text: ', H' },
        { type: 'text', marks: [{ type: 'subscript' }], text: '2' },
        { type: 'text', text: 'O' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Top level' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
      attrs: { indent: 2 },
      content: [{ type: 'text', text: 'Indented paragraph' }],
    },
    { type: 'image', attrs: { src: 'https://cdn.example.com/banner.png' } },
  ],
}

/** The HTML equivalent of RICH_DOC, as the editor would hand it to a server action. */
const RICH_HTML =
  '<p>E = mc<sup>2</sup>, H<sub>2</sub>O</p>' +
  '<ul><li><p>Top level</p><ul><li><p>Nested</p></li></ul></li></ul>' +
  '<p style="margin-left: 3rem">Indented paragraph</p>' +
  '<img src="https://cdn.example.com/banner.png">'

describe('the editor schema', () => {
  it('has a mark for every mark the toolbar toggles', () => {
    expect(Object.keys(schema.marks)).toEqual(
      expect.arrayContaining(['bold', 'italic', 'underline', 'superscript', 'subscript', 'link']),
    )
  })

  it('has a node for every block the toolbar inserts', () => {
    expect(Object.keys(schema.nodes)).toEqual(
      expect.arrayContaining([
        'paragraph',
        'bulletList',
        'orderedList',
        'listItem',
        'image',
        'blockquote',
        'horizontalRule',
      ]),
    )
  })

  it('writes the same tags for superscript and subscript that it parses back', () => {
    expectTagRoundTrip(schema.marks.superscript, 'sup')
    expectTagRoundTrip(schema.marks.subscript, 'sub')
  })

  it('writes an image as an img with the src it was given', () => {
    const image = schema.nodes.image
    const written = image.spec.toDOM?.(image.create({ src: 'https://cdn.example.com/a.png' }))
    const [tag, attributes] = Array.isArray(written) ? written : []

    expect(tag).toBe('img')
    expect(attributes).toMatchObject({ src: 'https://cdn.example.com/a.png' })
  })
})

describe('a document with all five new affordances in it', () => {
  it('is a valid document in this schema', () => {
    // `check` throws when the content does not match the schema, which is what would
    // happen if a nested list were not allowed inside a list item.
    expect(() => ProseMirrorNode.fromJSON(schema, RICH_DOC).check()).not.toThrow()
  })

  it('keeps both marks, the nesting, the indent and the image through a JSON round trip', () => {
    const node = ProseMirrorNode.fromJSON(schema, RICH_DOC)
    const reloaded = ProseMirrorNode.fromJSON(schema, node.toJSON())

    const marks = new Set<string>()
    let images = 0
    let deepest = 0
    reloaded.descendants((child, _pos, _parent) => {
      for (const mark of child.marks) marks.add(mark.type.name)
      if (child.type.name === 'image') images += 1
      return true
    })
    reloaded.descendants((child) => {
      if (child.type.name === 'bulletList') deepest += 1
      return true
    })

    expect(marks).toEqual(new Set(['superscript', 'subscript']))
    expect(images).toBe(1)
    // Two bullet lists, which is one list nested inside another: the indent button's work
    // inside a list is exactly this shape.
    expect(deepest).toBe(2)
    expect(reloaded.child(2).attrs.indent).toBe(2)
  })

  it('renders the indent as a margin next to an alignment rather than instead of it', () => {
    const paragraph = schema.nodes.paragraph
    const written = paragraph.spec.toDOM?.(paragraph.create({ textAlign: 'center', indent: 2 }))
    const [, attributes] = Array.isArray(written) ? written : []

    expect(attributes).toEqual({ style: 'text-align: center; margin-left: 3rem' })
  })

  it('reads a stored margin-left back as the level that wrote it', () => {
    const rule = schema.nodes.paragraph.spec.parseDOM?.at(0)
    const attributes = rule?.getAttrs?.(elementWithStyle({ marginLeft: '3rem' }))

    expect(attributes).toMatchObject({ indent: 2 })
  })

  it('leaves a plain paragraph plain, so untouched markup is not rewritten', () => {
    const paragraph = schema.nodes.paragraph
    const written = paragraph.spec.toDOM?.(paragraph.create())
    const [, attributes] = Array.isArray(written) ? written : []
    const rule = paragraph.spec.parseDOM?.at(0)

    expect(attributes).toEqual({})
    expect(rule?.getAttrs?.(elementWithStyle({ marginLeft: '' }))).toMatchObject({ indent: 0 })
  })
})

describe('indentStyle and indentLevelFromStyle', () => {
  it('round trip every level the buttons can reach', () => {
    for (let level = 1; level <= MAX_INDENT_LEVEL; level += 1) {
      const style = indentStyle(level)
      expect(style).toBeDefined()
      expect(indentLevelFromStyle((style ?? '').replace('margin-left: ', ''))).toBe(level)
    }
  })

  it('writes nothing at all at level zero', () => {
    expect(indentStyle(0)).toBeUndefined()
    expect(indentStyle(-3)).toBeUndefined()
  })

  it('clamps rather than growing without limit', () => {
    expect(clampIndent(MAX_INDENT_LEVEL + 5)).toBe(MAX_INDENT_LEVEL)
    expect(clampIndent(-2)).toBe(0)
    expect(clampIndent(Number.NaN)).toBe(0)
  })

  it('reads a margin authored in px, which is what other editors emit', () => {
    expect(indentLevelFromStyle('48px')).toBe(2)
    expect(indentLevelFromStyle('  24px  ')).toBe(1)
  })

  it('reads anything it cannot understand as no indent', () => {
    expect(indentLevelFromStyle('')).toBe(0)
    expect(indentLevelFromStyle('auto')).toBe(0)
    expect(indentLevelFromStyle('10%')).toBe(0)
    expect(indentLevelFromStyle('1.2.3rem')).toBe(0)
  })
})

describe('safeHttpUrl', () => {
  it('accepts an absolute http or https address and trims it', () => {
    expect(safeHttpUrl('  https://cdn.example.com/a.png ')).toBe('https://cdn.example.com/a.png')
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com')
  })

  it('refuses every scheme that would run or embed something', () => {
    // The threat is concrete: this guard is what both the link button and the image button
    // put between an organizer's paste and markup rendered on the public form.
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeUndefined()
    expect(safeHttpUrl('/uploads/logo.png')).toBeUndefined()
    expect(safeHttpUrl('example.com/a.png')).toBeUndefined()
    expect(safeHttpUrl('')).toBeUndefined()
    expect(safeHttpUrl('https://has a space/x.png')).toBeUndefined()
  })
})

describe('the storage boundary the builder saves through', () => {
  const base = draftFromForm(CFP_FORM, ZONE)

  it('keeps a body with superscript, subscript, an indent and an image, and reloads it', () => {
    const write = toFormWrite({ ...base, welcomeEnabled: true, welcomeHtml: RICH_HTML }, ZONE)
    const reloaded = draftFromForm({ ...CFP_FORM, welcomeHtml: write.welcomeHtml }, ZONE)

    expect(write.welcomeHtml).toBe(RICH_HTML)
    expect(reloaded.welcomeHtml).toBe(RICH_HTML)
    expect(reloaded.welcomeEnabled).toBe(true)
  })

  it('keeps the same body in the confirmation email, which has the same toolbar', () => {
    const write = toFormWrite({ ...base, confirmationEmailHtml: RICH_HTML }, ZONE)

    expect(write.confirmationEmailHtml).toBe(RICH_HTML)
  })

  it('still stores a cleared editor as absent', () => {
    // The reason this assertion is here rather than only in builder-draft.test.ts: adding
    // marks to the schema changes what an "empty" document serialises as, and the emptiness
    // test strips tags, so a new wrapper tag must not start counting as content.
    for (const empty of ['', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>']) {
      const write = toFormWrite({ ...base, welcomeEnabled: true, welcomeHtml: empty }, ZONE)

      expect(write.welcomeHtml).toBeUndefined()
    }
  })

  it('keeps a body whose only content is an image', () => {
    // This assertion was the other way round when the image button landed, pinned as
    // characterisation because the emptiness rule lived in a file this change did not own:
    // stripping tags and testing the remaining TEXT reported an image-only body as empty, so
    // it was stored as absent and the image vanished on the next load. The rule now lives in
    // `src/features/forms/builder/emptiness.ts`, is shared with the render side, and knows
    // that an `<img>` is content. `tests/rich-text-emptiness.test.ts` covers it directly;
    // this one holds the storage boundary end of it.
    const html = '<img src="https://cdn.example.com/a.png">'
    const write = toFormWrite({ ...base, welcomeEnabled: true, welcomeHtml: html }, ZONE)

    expect(write.welcomeHtml).toBe(html)
  })
})

/** What a mark writes has to be what its parse rules match, or a reload loses it. */
function expectTagRoundTrip(mark: MarkType, tag: string): void {
  const written = mark.spec.toDOM?.(mark.create(), true)

  expect(Array.isArray(written) ? written[0] : undefined).toBe(tag)
  expect(mark.spec.parseDOM?.map((rule) => rule.tag)).toContain(tag)
}

/** A stand-in for the element a parse rule is handed, carrying only the style it reads. */
function elementWithStyle(style: Partial<CSSStyleDeclaration>): HTMLElement {
  return { style, getAttribute: () => null, hasAttribute: () => false } as unknown as HTMLElement
}
