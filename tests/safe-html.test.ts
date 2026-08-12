// The sanitizer for organizer-authored HTML, and where it is allowed to be called from.
//
// Every attack case here is a thing that used to reach a public visitor's browser. Three
// components set `dangerouslySetInnerHTML` from an Airtable column, each defending it on the
// grounds that only an authenticated event admin writes it. An event admin is a customer rather
// than the operator, and the column is writable straight from the Airtable UI, so neither the
// editor's button guards nor TipTap's parse rules are between an attacker and the sink. Found by
// Codex review.
//
// The last group exists because the FIRST fix was in the wrong place. Calling the sanitizer at
// each render sink stopped the XSS and introduced two new problems, both measured on the deployed
// Worker: `OrganizerHtml` is reached from the wizard's client components, so sanitize-html and
// postcss landed in three client chunks, and the raw markup was still sent to the browser in the
// RSC payload. Those tests pin the sanitizer to the DAL read boundary and pin the sinks to NOT
// importing it, so the placement cannot quietly drift back.
//
// The formatting cases matter as much as the attack cases: a sanitizer that strips the editor's
// own alignment and indentation would be a silent formatting regression, which is how allowlists
// usually get widened back into uselessness.

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { safeRichHtml, safeStoredHtml } from '@/utils/safe-html'

describe('safeRichHtml, attacks', () => {
  it('strips event handler attributes', () => {
    const out = safeRichHtml('<p>hi</p><img src="https://x.test/a.png" onerror="alert(1)">')

    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert')
    // The image itself survives, which is the point: this is a filter, not a refusal.
    expect(out).toContain('src="https://x.test/a.png"')
  })

  it('removes a script element and its text, not just its tags', () => {
    const out = safeRichHtml('<p>before</p><script>alert(document.cookie)</script><p>after</p>')

    expect(out).not.toContain('script')
    // Leaving the body behind would render `alert(document.cookie)` as visible page copy.
    expect(out).not.toContain('document.cookie')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  it('drops a javascript: link but keeps the text it wrapped', () => {
    const out = safeRichHtml('<p><a href="javascript:alert(1)">Click me</a></p>')

    expect(out).not.toContain('javascript:')
    expect(out).toContain('Click me')
  })

  it('drops a data: URL on both a link and an image', () => {
    const out = safeRichHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>' +
        '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    )

    expect(out).not.toContain('data:')
  })

  it('removes an iframe, an object and a form outright', () => {
    // None of these is insertable by the editor, so nothing legitimate is lost. An iframe is the
    // one that matters: the portal renders admin HTML, and a framed page is a phishing surface
    // inside a speaker's authenticated session.
    const out = safeRichHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object>' +
        '<form action="https://evil.test"><input name="password"></form>',
    )

    for (const tag of ['iframe', 'object', 'form', 'input']) expect(out).not.toContain(tag)
  })

  it('refuses a style attribute that is not alignment or indentation', () => {
    // Allowing `style` wholesale reintroduces the sink through CSS: a full-viewport absolutely
    // positioned block over the page is a clickjack without a single script tag.
    const out = safeRichHtml(
      '<p style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:red">x</p>',
    )

    expect(out).not.toContain('position')
    expect(out).not.toContain('100vw')
  })

  it('refuses an svg, which carries its own handler surface', () => {
    const out = safeRichHtml('<svg><a><animate onbegin="alert(1)" attributeName="x"/></a></svg>')

    expect(out).not.toContain('onbegin')
    expect(out).not.toContain('svg')
  })

  it('gives every surviving link noopener noreferrer', () => {
    // An organizer legitimately links out of a welcome message. A bare target="_blank" hands
    // `window.opener` to whatever they linked to.
    const out = safeRichHtml('<a href="https://x.test" target="_blank">x</a>')

    expect(out).toContain('rel="noopener noreferrer"')
  })
})

describe('safeRichHtml, formatting the editor really produces', () => {
  it('keeps every mark the toolbar can apply', () => {
    const html =
      '<h2>Title</h2><p><strong>b</strong><em>i</em><u>u</u><s>s</s>' +
      '<sup>2</sup><sub>2</sub></p><ul><li>a</li></ul><ol><li>b</li></ol><hr>'
    const out = safeRichHtml(html)

    for (const tag of ['h2', 'strong', 'em', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li', 'hr']) {
      expect(out).toContain(`<${tag}`)
    }
  })

  it('keeps alignment and every indent level BlockIndent can emit', () => {
    // The step is 1.5rem and the clamp is 8, so these are the real serialised values. If the
    // allowlist pattern and the extension's step ever disagree, indentation vanishes on render
    // while still looking right in the editor, which is the worst version of this bug.
    expect(safeRichHtml('<p style="text-align: center">x</p>')).toContain('text-align')

    for (const level of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const value = `${String(level * 1.5)}rem`
      const out = safeRichHtml(`<p style="margin-left: ${value}">x</p>`)
      expect(out, `indent level ${String(level)} (${value}) must survive`).toContain('margin-left')
    }
  })

  it('refuses an absurd indent that did not come from the clamp', () => {
    expect(safeRichHtml('<p style="margin-left: 4000rem">x</p>')).not.toContain('margin-left')
    expect(safeRichHtml('<p style="margin-left: -50rem">x</p>')).not.toContain('margin-left')
    expect(safeRichHtml('<p style="margin-left: calc(100vw - 1px)">x</p>')).not.toContain('margin')
  })

  it('keeps a mailto link, which is ordinary welcome copy', () => {
    expect(safeRichHtml('<a href="mailto:x@y.test">mail</a>')).toContain('mailto:')
  })

  it('leaves plain text and empty input alone', () => {
    expect(safeRichHtml('')).toBe('')
    expect(safeRichHtml('<p>Just words.</p>')).toBe('<p>Just words.</p>')
  })
})

describe('the DAL read boundary is where sanitizing happens', () => {
  it('sanitizes an undefined column without inventing a value', () => {
    expect(safeStoredHtml(undefined)).toBeUndefined()
    expect(safeStoredHtml('<p>ok</p>')).toBe('<p>ok</p>')
  })

  it('is applied by mapForm to every HTML column, not just the welcome body', async () => {
    // The point of moving this out of the render sinks: a NEW consumer of any of these columns
    // cannot forget, and the browser never receives the unsafe string. Asserted against the
    // mapper's source rather than a live record, because constructing five Airtable rows here
    // would test the fixture and not the wiring.
    const source = await readFile('src/services/airtable/mapping-forms.ts', 'utf8')

    for (const column of [
      'welcomeHtml',
      'abstractSectionHtml',
      'participantSectionHtml',
      'successHtml',
      'confirmationEmailHtml',
    ]) {
      expect(source, `${column} must be sanitized at the mapper`).toContain(
        `${column}: safeStoredHtml(`,
      )
    }
  })

  it('is applied by mapFileRequest to the instructions a speaker reads', async () => {
    const source = await readFile('src/services/airtable/mapping-requests.ts', 'utf8')
    expect(source).toContain('instructionsHtml: safeStoredHtml(')
  })

  it('is NOT called from the components that render, which is what bundled it to the client', async () => {
    // sanitize-html pulls in postcss. Calling it from `OrganizerHtml`, which the public wizard's
    // client components import, put both in three client chunks on a project judged on speed.
    for (const file of [
      'src/components/primitives/OrganizerHtml.tsx',
      'src/features/portal/RequestedFilesPanel.tsx',
      'src/app/(public)/submit/[eventSlug]/[formPublicId]/SuccessCard.tsx',
    ]) {
      const source = await readFile(file, 'utf8')
      expect(source, `${file} must not import the sanitizer`).not.toContain(
        "from '@/utils/safe-html'",
      )
    }
  })
})

describe('safeRichHtml, cases that matter because the policy is now local', () => {
  it('strips an UNQUOTED event handler, the case that broke the alternative', () => {
    // `ultrahtml` was evaluated as a lighter dependency and rejected partly here: it parsed
    // `<img src=x onerror="alert(1)">` into `src="alert(1)"`, keeping a wrong value from a
    // dangerous attribute. htmlparser2 tokenises it correctly and the allowlist drops the handler.
    const out = safeRichHtml('<img src=x onerror="alert(1)">')

    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert')
    // `x` is relative, so the src goes too, leaving a bare img rather than a wrong one.
    expect(out).toBe('<img>')
  })

  it('strips a handler however it is cased or spaced', () => {
    const out = safeRichHtml('<p OnClick="alert(1)" ONMOUSEOVER=alert(2)>x</p>')

    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out.toLowerCase()).not.toContain('onmouseover')
    expect(out).toBe('<p>x</p>')
  })

  it('refuses a relative or protocol-relative URL, so nothing resolves against our host', () => {
    for (const url of ['/x.png', '../x.png', '//evil.test/x.png', 'x.png']) {
      expect(safeRichHtml(`<img src="${url}">`), url).toBe('<img>')
    }
  })

  it('refuses a scheme hidden behind whitespace or control characters', () => {
    for (const href of ['  javascript:alert(1)', 'java\tscript:alert(1)', 'JaVaScRiPt:alert(1)']) {
      const out = safeRichHtml(`<a href="${href}">t</a>`)
      expect(out.toLowerCase(), href).not.toContain('javascript')
      // The text survives; only the href is dropped, so the copy is not silently deleted.
      expect(out).toContain('t')
    }
  })

  it('does not let a crossed or stray close tag unbalance the output', () => {
    // A hand-written serialiser is where this goes wrong: an unmatched `</p>` that emitted anyway
    // would close a wrapper the surrounding page opened, and the rest of the page would reflow
    // inside our block.
    // A stray `</p>` becomes an EMPTY paragraph, not nothing: htmlparser2 follows HTML5's
    // implied-open rule for that one tag. Harmless (a blank block), and asserted rather than
    // wished away, because the interesting property is that `</div>` vanishes entirely and no
    // unmatched close is ever emitted.
    expect(safeRichHtml('</p></div>text')).toBe('<p></p>text')
    expect(safeRichHtml('<p><strong>a</p></strong>')).toBe('<p><strong>a</strong></p>')
  })

  it('closes whatever the author left open', () => {
    expect(safeRichHtml('<p>a')).toBe('<p>a</p>')
    expect(safeRichHtml('<ul><li>a')).toBe('<ul><li>a</li></ul>')
  })

  it('escapes text so a stripped tag cannot be reassembled by the browser', () => {
    // The dropped `<script>` leaves its angle brackets nowhere; a literal `<` typed as text is
    // escaped rather than passed through, which is what stops two safe fragments concatenating
    // into one dangerous one.
    expect(safeRichHtml('<p>5 &lt; 6 &amp; 7 > 4</p>')).toBe('<p>5 &lt; 6 &amp; 7 &gt; 4</p>')
  })

  it('does not treat a comment as a place to hide markup', () => {
    expect(safeRichHtml('<!-- <script>alert(1)</script> -->x')).not.toContain('alert')
  })

  it('keeps only the matching half of a mixed style attribute', () => {
    const out = safeRichHtml('<p style="text-align: center; position: fixed; z-index: 99">x</p>')

    expect(out).toContain('text-align: center')
    expect(out).not.toContain('position')
    expect(out).not.toContain('z-index')
  })
})
