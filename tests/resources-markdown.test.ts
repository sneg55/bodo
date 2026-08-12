import { describe, expect, it } from 'vitest'

import { markdownBlocks, safeHref } from '@/features/resources/markdown'

describe('safeHref', () => {
  it('keeps http and https targets', () => {
    expect(safeHref('https://example.com/guide')).toBe('https://example.com/guide')
    expect(safeHref('http://example.com/')).toBe('http://example.com/')
  })

  it('keeps mailto and tel targets', () => {
    expect(safeHref('mailto:speakers@example.com')).toBe('mailto:speakers@example.com')
    expect(safeHref('tel:+15550100')).toBe('tel:+15550100')
  })

  it('keeps a relative or in-page target unchanged', () => {
    expect(safeHref('/portal/submissions')).toBe('/portal/submissions')
    expect(safeHref('#travel')).toBe('#travel')
  })

  it('refuses a javascript: target', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
  })

  it('refuses a javascript: target that hides behind case and whitespace', () => {
    expect(safeHref('  JaVaScRiPt:alert(1)')).toBeUndefined()
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined()
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined()
  })

  it('refuses a data: target, which can carry an HTML document', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
  })

  it('refuses vbscript: and file: targets', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined()
    expect(safeHref('file:///etc/passwd')).toBeUndefined()
  })

  it('refuses an empty target', () => {
    expect(safeHref('   ')).toBeUndefined()
  })
})

describe('markdownBlocks', () => {
  it('returns nothing for an empty body', () => {
    expect(markdownBlocks('')).toEqual([])
    expect(markdownBlocks('   \n\n ')).toEqual([])
  })

  it('shifts headings down one level, because the page owns the h1', () => {
    const blocks = markdownBlocks('# Getting here\n\n## Parking')
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, spans: [{ text: 'Getting here' }] },
      { kind: 'heading', level: 3, spans: [{ text: 'Parking' }] },
    ])
  })

  it('does not shift past h6', () => {
    const blocks = markdownBlocks('###### Deep')
    expect(blocks).toEqual([{ kind: 'heading', level: 6, spans: [{ text: 'Deep' }] }])
  })

  it('carries bold, italic and code marks on the spans they apply to', () => {
    const blocks = markdownBlocks('Wear **your** badge `at all times`.')
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: 'Wear ' },
          { text: 'your', strong: true },
          { text: ' badge ' },
          { text: 'at all times', code: true },
          { text: '.' },
        ],
      },
    ])
  })

  it('accumulates nested marks rather than losing the outer one', () => {
    const blocks = markdownBlocks('**bold and _both_**')
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: 'bold and ', strong: true },
          { text: 'both', strong: true, em: true },
        ],
      },
    ])
  })

  it('reads bullet and numbered lists', () => {
    expect(markdownBlocks('- one\n- two')).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] },
    ])
    expect(markdownBlocks('1. first\n2. second')).toEqual([
      { kind: 'list', ordered: true, items: [[{ text: 'first' }], [{ text: 'second' }]] },
    ])
  })

  it('parses marks inside a list item, not just in a paragraph', () => {
    // Regression: marked wraps a list item's inline content in a `text` token that carries
    // its OWN `tokens` array. Reading `token.text` there returned the raw source, so
    // `**AIE-Sandbox**` rendered with literal asterisks on the portal page.
    expect(markdownBlocks('- Wi-Fi: **AIE-Sandbox**')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ text: 'Wi-Fi: ' }, { text: 'AIE-Sandbox', strong: true }]],
      },
    ])
  })

  it('parses a link inside a list item', () => {
    expect(markdownBlocks('- see [the map](https://example.com/map)')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ text: 'see ' }, { text: 'the map', href: 'https://example.com/map' }]],
      },
    ])
  })

  it('drops raw HTML tags inside a list item, keeping their contents as inert text', () => {
    // marked tokenizes `<script>`, `alert(1)` and `</script>` separately inside a list
    // item, so the two tags are dropped and the body between them survives as ordinary
    // text. That is the safe outcome and worth pinning: the words are visible, and there
    // is no element for them to run in.
    expect(markdownBlocks('- careful <script>alert(1)</script>')).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: 'careful ' }, { text: 'alert(1)' }]] },
    ])
  })

  it('reads fenced code as text, never as markup', () => {
    expect(markdownBlocks('```\n<b>x</b>\n```')).toEqual([{ kind: 'code', text: '<b>x</b>' }])
  })

  it('reads a blockquote and a horizontal rule', () => {
    expect(markdownBlocks('> mind the step')).toEqual([
      { kind: 'quote', spans: [{ text: 'mind the step' }] },
    ])
    expect(markdownBlocks('---')).toEqual([{ kind: 'rule' }])
  })

  it('drops a raw HTML block instead of passing it through', () => {
    // This is the whole reason the body goes through the lexer rather than marked.parse:
    // markdown allows raw HTML, and a body rendered with innerHTML would be a second
    // stored-XSS surface with none of the embed iframe's isolation.
    expect(markdownBlocks('<script>alert(1)</script>')).toEqual([])
    expect(markdownBlocks('<div onclick="alert(1)">hi</div>')).toEqual([])
  })

  it('drops raw HTML that sits inside a paragraph', () => {
    const blocks = markdownBlocks('Careful <img src=x onerror=alert(1)> here')
    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ text: 'Careful ' }, { text: ' here' }] },
    ])
  })

  it('keeps a safe link as a link', () => {
    expect(markdownBlocks('[map](https://maps.example.com/x)')).toEqual([
      {
        kind: 'paragraph',
        spans: [{ text: 'map', href: 'https://maps.example.com/x' }],
      },
    ])
  })

  it('renders a javascript: link as plain text, so the words survive but nothing clicks', () => {
    expect(markdownBlocks('[click me](javascript:alert(1))')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'click me' }] },
    ])
  })

  it('renders an image as a link to itself rather than an img element', () => {
    expect(markdownBlocks('![Floor plan](https://cdn.example.com/plan.png)')).toEqual([
      {
        kind: 'paragraph',
        spans: [{ text: 'Floor plan', href: 'https://cdn.example.com/plan.png' }],
      },
    ])
  })

  it('drops a table rather than half-rendering one', () => {
    expect(markdownBlocks('| a | b |\n| - | - |\n| 1 | 2 |')).toEqual([])
  })
})

describe('safeHref, after Codex review', () => {
  it('leaves a path-relative link alone instead of pointing it at a dummy host', () => {
    // The bug. Only `/...` and `#...` were returned as written, so `guide.pdf` fell through
    // to the URL parse and came back as `https://bodo.invalid/guide.pdf`: a link to the
    // placeholder host that exists only to give the parser a base. Not a security hole,
    // just every ordinary relative link broken.
    expect(safeHref('guide.pdf')).toBe('guide.pdf')
    expect(safeHref('docs/venue-guide.pdf')).toBe('docs/venue-guide.pdf')
    expect(safeHref('../up-one.html')).toBe('../up-one.html')
  })

  it('still allows root-relative and fragment targets unchanged', () => {
    expect(safeHref('/portal/submissions')).toBe('/portal/submissions')
    expect(safeHref('#venue')).toBe('#venue')
  })

  it('treats a colon in a later path segment as relative, not as a scheme', () => {
    expect(safeHref('files/notes:draft')).toBe('files/notes:draft')
  })

  it('refuses a scheme hidden behind whitespace a browser would strip', () => {
    // The reason the relative fix classifies AFTER stripping control characters rather than
    // before: a browser discards them while parsing a scheme, so a tab inside "javascript"
    // still reads as `javascript:` to it. Testing the raw text would have called these
    // relative and returned them unchanged, which is the bypass.
    expect(safeHref('java\tscript:alert(1)')).toBeUndefined()
    expect(safeHref('java\nscript:alert(1)')).toBeUndefined()
    expect(safeHref(' javascript:alert(1)')).toBeUndefined()
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined()
  })

  it('still refuses every non-allowlisted scheme', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined()
  })
})
