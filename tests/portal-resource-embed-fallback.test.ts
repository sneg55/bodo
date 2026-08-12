// The caption under a resource embed: where the content comes from, and how to reach it
// when the frame renders blank.
//
// A speaker opening "Wi-Fi and AV" saw a white rectangle with attribution and zoom
// controls and no tiles on one load, and a black one on the next. The tiles are a third
// party's and may simply be blocked; what the page owed the reader either way was a line
// saying what was supposed to be there. It cannot be detected: the frame is cross-origin
// by construction, so a blocked embed and a working one are the same opaque rectangle from
// the parent, and `srcdoc` fires `onload` for our own wrapper regardless.

import { describe, expect, it } from 'vitest'

import { embedHostLabel, embedSources } from '@/features/resources/embed'

describe('embedSources', () => {
  it('finds the address behind a map embed', () => {
    const html = '<iframe src="https://www.google.com/maps/embed?pb=!1m18" height="400"></iframe>'

    expect(embedSources(html)).toEqual(['https://www.google.com/maps/embed?pb=!1m18'])
  })

  it('decodes the entity form of an ampersand, so the link is the one the embed uses', () => {
    const html = '<iframe src="https://example.com/map?z=12&amp;q=venue"></iframe>'

    expect(embedSources(html)).toEqual(['https://example.com/map?z=12&q=venue'])
  })

  it('drops anything that is not absolute http(s), including a javascript href', () => {
    // The shared guard, the same one the editors apply: an extracted URL becomes an anchor
    // on the speaker's page, so organizer markup must not be able to put a script there.
    const html =
      '<a href="javascript:alert(1)">x</a><img src="/local.png"><a href="data:text/html,x">y</a>'

    expect(embedSources(html)).toEqual([])
  })

  it('deduplicates and caps at three, because this is a caption', () => {
    const html = [
      '<iframe src="https://a.example/one"></iframe>',
      '<a href="https://a.example/one">again</a>',
      '<a href="https://b.example/two">two</a>',
      '<a href="https://c.example/three">three</a>',
      '<a href="https://d.example/four">four</a>',
    ].join('')

    expect(embedSources(html)).toEqual([
      'https://a.example/one',
      'https://b.example/two',
      'https://c.example/three',
    ])
  })

  it('starts from the beginning on every call', () => {
    // One shared `g` regex carries `lastIndex`, so a second read of the same markup would
    // otherwise return nothing.
    const html = '<iframe src="https://example.com/embed"></iframe>'

    expect(embedSources(html)).toEqual(embedSources(html))
  })
})

describe('embedHostLabel', () => {
  it('labels the link with the host rather than a tracking URL', () => {
    expect(embedHostLabel('https://www.google.com/maps/embed?pb=!1m18')).toBe('google.com')
    expect(embedHostLabel('https://maps.example.org/venue')).toBe('maps.example.org')
  })
})
