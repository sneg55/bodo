import { describe, expect, it } from 'vitest'

import { embedPath, embedSnippet, embedUrl, escapeAttribute } from '@/features/cms/snippet'

describe('embed url', () => {
  it('addresses the embed by its opaque publicId and never by a record id', () => {
    expect(embedPath('agn7Kq2')).toBe('/embed/agn7Kq2')
  })

  it('carries validated deep-link values into the path', () => {
    expect(embedPath('agn7Kq2', { view: 'speaker_list', speakerId: 'recAda' })).toBe(
      '/embed/agn7Kq2?sb-view=speaker_list&sb-speaker-id=recAda',
    )
  })

  it('does not double the slash when the origin has a trailing one', () => {
    expect(embedUrl('https://bodo.example/', 'agn7Kq2')).toBe('https://bodo.example/embed/agn7Kq2')
    expect(embedUrl('https://bodo.example', 'agn7Kq2')).toBe('https://bodo.example/embed/agn7Kq2')
  })
})

describe('get code snippet', () => {
  it('emits one iframe pointing at the embed URL', () => {
    const snippet = embedSnippet({ url: 'https://bodo.example/embed/agn7Kq2', name: 'New Embed' })

    expect(snippet).toContain('<iframe src="https://bodo.example/embed/agn7Kq2"')
    expect(snippet).toContain('title="New Embed"')
    expect(snippet).toContain('</iframe>')
    // No script tag: the snippet must not run our code inside somebody else's page.
    expect(snippet).not.toContain('<script')
  })

  it('escapes the name, because the snippet is pasted into somebody else HTML', () => {
    const snippet = embedSnippet({
      url: 'https://bodo.example/embed/agn7Kq2',
      name: 'Ada\'s "big" <feed>',
    })

    expect(snippet).toContain('title="Ada&#39;s &quot;big&quot; &lt;feed&gt;"')
    expect(snippet).not.toContain('<feed>')
  })

  it('escapes an ampersand once and not twice', () => {
    expect(escapeAttribute('Tracks & Rooms')).toBe('Tracks &amp; Rooms')
    expect(escapeAttribute('a<b>&"c"')).toBe('a&lt;b&gt;&amp;&quot;c&quot;')
  })

  it('honours an explicit height and defaults to one otherwise', () => {
    const url = 'https://bodo.example/embed/x'
    expect(embedSnippet({ url, name: 'n', height: 320 })).toContain('height="320"')
    expect(embedSnippet({ url, name: 'n' })).toContain('height="640"')
  })
})
