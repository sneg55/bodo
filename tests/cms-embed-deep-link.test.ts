import { describe, expect, it } from 'vitest'

import {
  EMBED_SPEAKER_PARAM,
  EMBED_VIEW_PARAM,
  embedQueryString,
  parseEmbedDeepLink,
  parseEmbedQuery,
} from '@/features/cms/deep-link'

describe('embed deep link parsing', () => {
  it('reads the captured parameter off ref 33 URL bar', () => {
    expect(parseEmbedDeepLink({ [EMBED_SPEAKER_PARAM]: 'recSpeaker123' })).toEqual({
      speakerId: 'recSpeaker123',
    })
  })

  it('accepts no parameters at all, which is how most embeds are loaded', () => {
    expect(parseEmbedDeepLink({})).toEqual({})
  })

  it('takes the first value when a key is repeated', () => {
    // Next hands a repeated key over as an array, and `String(array)` would build
    // "recA,recB" and match no speaker at all.
    expect(parseEmbedDeepLink({ [EMBED_SPEAKER_PARAM]: ['recA', 'recB'] })).toEqual({
      speakerId: 'recA',
    })
  })

  it('drops a hostile speaker id instead of passing it to a record lookup or into HTML', () => {
    const hostile = [
      '<script>alert(1)</script>',
      "rec' OR 1=1",
      'rec/../../etc/passwd',
      'rec 123',
      '',
      '   ',
      'x'.repeat(200),
    ]

    for (const value of hostile) {
      expect(parseEmbedDeepLink({ [EMBED_SPEAKER_PARAM]: value })).toEqual({})
    }
  })

  it('ignores a parameter named __proto__ rather than reading off the prototype chain', () => {
    const params = JSON.parse('{"__proto__": "recEvil"}') as Record<string, string>
    expect(parseEmbedDeepLink(params)).toEqual({})
  })

  it('honours a known view and drops an unknown one, so the record view stays the fallback', () => {
    expect(parseEmbedDeepLink({ [EMBED_VIEW_PARAM]: 'speaker_gallery' })).toEqual({
      view: 'speaker_gallery',
    })
    expect(parseEmbedDeepLink({ [EMBED_VIEW_PARAM]: 'agenda; drop table' })).toEqual({})
    expect(parseEmbedDeepLink({ [EMBED_VIEW_PARAM]: 'Agenda' })).toEqual({})
  })

  it('parses the raw query string an organizer types into the preview URL bar', () => {
    expect(parseEmbedQuery('?sb-speaker-id=abc123')).toEqual({ speakerId: 'abc123' })
    expect(parseEmbedQuery('sb-speaker-id=abc123&sb-view=session_list')).toEqual({
      speakerId: 'abc123',
      view: 'session_list',
    })
  })

  it('round trips only validated values, so a dropped value cannot come back out', () => {
    const link = parseEmbedQuery('?sb-speaker-id=<script>&sb-view=speaker_list')
    expect(embedQueryString(link)).toBe('?sb-view=speaker_list')
    expect(embedQueryString({})).toBe('')
  })
})
