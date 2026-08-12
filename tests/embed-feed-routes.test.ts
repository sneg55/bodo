// Where each format is served, and what the organizer is given to copy.
//
// The addressing scheme spans three files that cannot import each other: the extension lives in
// `format-options`, the rewrite that maps it onto a route lives in `next.config.ts`, and the
// route segment that answers lives under `src/app/(public)/embed`. Nothing type-checks that
// triple, and the failure it produces is a Format an organizer can select whose URL 404s.
//
// So the last block reads `next.config.ts` as TEXT and asserts the rewrite exists for every
// format that has one. Coarse on purpose: the alternative is importing the config, which calls
// `initOpenNextCloudflareForDev()` at module load and would start reaching for Cloudflare
// bindings inside a unit test.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  EMBED_FEED_KINDS,
  embedFeedContentType,
  embedFeedKind,
  embedFormatIsFramed,
  embedFormatKind,
  embedFormatSuffix,
} from '@/features/cms/format-options'
import { embedFormatPath, embedFormatUrl, embedShare } from '@/features/cms/snippet'
import { EMBED_FORMATS } from '@/types/cms'

const ORIGIN = 'https://bodo.example'
const PUBLIC_ID = 'agn7Kq2'

describe('every format has one address', () => {
  it('serves styled HTML at the bare embed URL', () => {
    expect(embedFormatPath(PUBLIC_ID, 'styled_html')).toBe('/embed/agn7Kq2')
  })

  it('serves each feed at an extension on that same URL', () => {
    expect(embedFormatPath(PUBLIC_ID, 'basic_html')).toBe('/embed/agn7Kq2.html')
    expect(embedFormatPath(PUBLIC_ID, 'json')).toBe('/embed/agn7Kq2.json')
    expect(embedFormatPath(PUBLIC_ID, 'xml')).toBe('/embed/agn7Kq2.xml')
    expect(embedFormatPath(PUBLIC_ID, 'ical')).toBe('/embed/agn7Kq2.ics')
  })

  it('keeps the deep link on the feed, after the extension', () => {
    expect(embedFormatPath(PUBLIC_ID, 'json', { speakerId: 'recAda' })).toBe(
      '/embed/agn7Kq2.json?sb-speaker-id=recAda',
    )
    expect(embedFormatUrl(ORIGIN, PUBLIC_ID, 'ical', { view: 'session_list' })).toBe(
      'https://bodo.example/embed/agn7Kq2.ics?sb-view=session_list',
    )
  })

  it('gives every format a distinct URL, so no two formats collide', () => {
    const paths = EMBED_FORMATS.map((format) => embedFormatPath(PUBLIC_ID, format))
    expect(new Set(paths).size).toBe(EMBED_FORMATS.length)
  })
})

describe('the route handler vocabulary', () => {
  it('accepts exactly the four feed segments and nothing else', () => {
    for (const kind of EMBED_FEED_KINDS) expect(embedFeedKind(kind)).toBe(kind)
    expect(embedFeedKind('rss')).toBeUndefined()
    expect(embedFeedKind('')).toBeUndefined()
    expect(embedFeedKind('JSON')).toBeUndefined()
  })

  it('answers each with the content type its consumer keys off', () => {
    expect(embedFeedContentType('json')).toBe('application/json; charset=utf-8')
    expect(embedFeedContentType('xml')).toBe('application/xml; charset=utf-8')
    expect(embedFeedContentType('ics')).toBe('text/calendar; charset=utf-8')
    expect(embedFeedContentType('html')).toBe('text/html; charset=utf-8')
  })

  it('routes every non-styled format to a feed segment, and styled HTML to none', () => {
    expect(embedFormatKind('styled_html')).toBeUndefined()
    for (const format of EMBED_FORMATS.filter((candidate) => candidate !== 'styled_html')) {
      expect(embedFormatKind(format)).toBeDefined()
    }
  })
})

describe('what Get Code hands over', () => {
  it('is an iframe for the two formats a page can frame', () => {
    for (const format of ['styled_html', 'basic_html'] as const) {
      const share = embedShare({ origin: ORIGIN, publicId: PUBLIC_ID, format, name: 'Agenda' })

      expect(embedFormatIsFramed(format)).toBe(true)
      expect(share.snippet).toContain('<iframe src="')
      expect(share.snippet).toContain(share.url)
      expect(share.snippetLabel).toBe('Embed code')
    }
  })

  it('is the URL alone for a feed, because there is no markup to paste', () => {
    for (const format of ['json', 'xml', 'ical'] as const) {
      const share = embedShare({ origin: ORIGIN, publicId: PUBLIC_ID, format, name: 'Agenda' })

      expect(embedFormatIsFramed(format)).toBe(false)
      expect(share.snippet).toBeUndefined()
      expect(share.url).toBe(embedFormatUrl(ORIGIN, PUBLIC_ID, format))
      expect(share.hint).not.toBe('')
    }
  })

  it('escapes the embed name into the iframe title, which lands in somebody else HTML', () => {
    const share = embedShare({
      origin: ORIGIN,
      publicId: PUBLIC_ID,
      format: 'styled_html',
      name: 'Ada\'s "big" <feed>',
    })

    expect(share.snippet).toContain('title="Ada&#39;s &quot;big&quot; &lt;feed&gt;"')
  })
})

describe('the extension is actually routed', () => {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8')

  it('rewrites every format extension onto its route segment', () => {
    for (const format of EMBED_FORMATS) {
      const kind = embedFormatKind(format)
      if (kind === undefined) continue
      // The source pattern and the destination segment, as next.config.ts spells them.
      expect(config).toContain(`\${EMBED_ID}${embedFormatSuffix(format)}\``)
      expect(config).toContain(`'/embed/:publicId/${kind}'`)
    }
  })

  it('constrains the id to the alphabet nanoid mints', () => {
    expect(config).toContain("const EMBED_ID = ':publicId([A-Za-z0-9_-]+)'")
  })
})
