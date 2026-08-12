// What actually reaches a speaker's page when an organizer pastes hostile markup.
//
// These assertions are against the SERIALISED HTML the portal sends, not against a
// helper's return value, because the security property is a property of the rendered
// element: the payload has to be inside a `srcdoc` attribute on a sandboxed iframe, and
// nowhere else. `renderToStaticMarkup` is what the RSC renderer does to this component,
// so the strings below are what a browser receives.
//
// The component is built with `createElement` rather than JSX because vitest.config.mts
// only collects `tests/**/*.test.ts`.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { EMBED_SANDBOX, embedDocument, embedTitle, hasEmbed } from '@/features/resources/embed'
import { ResourceEmbed } from '@/features/resources/ResourceEmbed'

function render(html: string, resourceTitle = 'Venue'): string {
  return renderToStaticMarkup(createElement(ResourceEmbed, { html, resourceTitle }))
}

/** Attribute NAMES only. React 19 emits `srcDoc`; a browser parses it as `srcdoc`. */
function renderLower(html: string, resourceTitle = 'Venue'): string {
  return render(html, resourceTitle).toLowerCase()
}

const SCRIPT_PAYLOAD = '<script>fetch("/api/steal?c="+document.cookie)</script>'
const HANDLER_PAYLOAD = '<img src=x onerror="alert(document.domain)">'
const BREAKOUT_PAYLOAD = '"></iframe><script>alert(1)</script><iframe srcdoc="'

describe('EMBED_SANDBOX', () => {
  it('grants scripts, forms and popups, because a real embed needs them', () => {
    expect(EMBED_SANDBOX.split(' ').sort()).toEqual([
      'allow-forms',
      'allow-popups',
      'allow-scripts',
    ])
  })

  it('never grants allow-same-origin, which would undo the whole isolation', () => {
    // With allow-scripts AND allow-same-origin the frame is same-origin with the app:
    // script inside it can read parent.document, and can strip the sandbox attribute
    // from its own iframe element and reload itself unsandboxed. BUILD_SPEC 5.8 names
    // that pair; this is the deliberate deviation.
    expect(EMBED_SANDBOX).not.toContain('allow-same-origin')
  })

  it('never grants allow-popups-to-escape-sandbox, so an opened tab stays sandboxed', () => {
    expect(EMBED_SANDBOX).not.toContain('escape-sandbox')
  })
})

describe('embedDocument', () => {
  it('inserts the payload verbatim, because this module isolates rather than sanitizes', () => {
    // Deliberate. A partial strip here would suggest the contents had been vetted.
    expect(embedDocument(SCRIPT_PAYLOAD)).toContain(SCRIPT_PAYLOAD)
  })

  it('declares a charset, since a srcdoc document inherits none from its parent', () => {
    expect(embedDocument('hi')).toContain('<meta charset="utf-8">')
  })

  it('lets a pasted embed grow into the fixed frame instead of leaving dead space under it', () => {
    // The frame is a fixed 32rem and cannot be auto-sized, but a pasted embed brings its own
    // height: OpenStreetMap's share markup says 350, YouTube's says 315. So the box was
    // 512px tall with a 350px map in it and ~160px of empty background below, which reads as
    // a broken embed rather than as a fixed-height one.
    const doc = embedDocument('<iframe src="https://example.test"></iframe>')

    expect(doc).toContain('body>iframe{flex:1 0 auto;width:100%}')
    expect(doc).toContain('display:flex;flex-direction:column')
  })

  it('never SHRINKS an embed that is taller than the frame', () => {
    // The `0` in `flex:1 0 auto` is the half that is easy to lose. Grow-only means a tall
    // embed keeps its own height and the frame scrolls, which is what a fixed frame height
    // promises; allowing shrink would squash it to fit and silently crop the content.
    expect(embedDocument('x')).toContain('flex:1 0 auto')
    expect(embedDocument('x')).not.toContain('flex:1 1 auto')
  })

  it('leaves a script-built widget alone, reaching only a direct iframe child', () => {
    // Nothing here knows what shape a third party's `div` wants, and a rule on every element
    // is how an embed's own layout gets broken from outside.
    expect(embedDocument('x')).not.toContain('body>*{flex')
  })
})

describe('embedTitle', () => {
  it('names the frame after its resource', () => {
    expect(embedTitle('Venue and Travel')).toBe('Venue and Travel: embedded content')
  })

  it('falls back to a generic name rather than an empty accessible name', () => {
    expect(embedTitle('   ')).toBe('Embedded content')
  })
})

describe('hasEmbed', () => {
  it('treats absent and whitespace-only markup as no embed', () => {
    expect(hasEmbed(undefined)).toBe(false)
    expect(hasEmbed('   \n ')).toBe(false)
  })

  it('treats real markup as an embed', () => {
    expect(hasEmbed('<b>hi</b>')).toBe(true)
  })
})

describe('rendered markup, against hostile input', () => {
  it('renders a sandboxed iframe with an accessible name', () => {
    const markup = render('<b>hello</b>')
    expect(markup).toContain('<iframe')
    expect(markup).toContain(`sandbox="${EMBED_SANDBOX}"`)
    expect(markup).toContain('title="Venue: embedded content"')
  })

  it('never emits a script element into the speaker page', () => {
    const markup = render(SCRIPT_PAYLOAD)
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('</script>')
    // Present, but escaped, so the parser sees attribute text and not a tag.
    expect(markup).toContain('&lt;script&gt;')
  })

  it('escapes an event-handler payload so no element in the page carries it', () => {
    const markup = render(HANDLER_PAYLOAD)
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')
    // `onerror=` survives as TEXT inside the srcdoc attribute value. That is expected:
    // the frame is where it runs, in an opaque origin. What must not happen is an
    // element in the parent document carrying it, which the previous two lines cover.
    expect(markup.indexOf('onerror')).toBeGreaterThan(
      renderLower(HANDLER_PAYLOAD).indexOf('srcdoc='),
    )
  })

  it('cannot be broken out of the srcdoc attribute with a quote', () => {
    const markup = render(BREAKOUT_PAYLOAD)
    // The payload's quote and its closing tag are both escaped, so neither terminates
    // the attribute nor the element.
    expect(markup).toContain('&quot;')
    expect(markup).toContain('&lt;/iframe&gt;')
    expect(markup).not.toContain('<script')
    // Exactly one iframe: the payload did not manage to open a second one.
    expect(markup.split('<iframe').length - 1).toBe(1)
    // ...and exactly one closing tag, the component's own.
    expect(markup.split('</iframe>').length - 1).toBe(1)
  })

  it('does not leak the portal URL to whatever the embed loads', () => {
    // React 19 serialises these two attribute names camel-cased. HTML attribute names
    // are case-insensitive, so a browser reads `srcdoc` and `referrerpolicy`; the test
    // lowercases rather than pretending the serialiser does.
    expect(render('<b>x</b>').toLowerCase()).toContain('referrerpolicy="no-referrer"')
  })
})
