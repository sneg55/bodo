// What the Connect form does with whatever an organizer pastes into it.
//
// Worth testing directly rather than through the dialog, because the failure it prevents is
// silent: `accelEventUrl` is a path SEGMENT despite the name, and the client interpolates it
// into `/rest/host/event/{eventUrl}/speakers`. Storing a browser address verbatim builds a
// request path with a whole URL inside it, which 404s with nothing on screen to explain why.
// Every case below is something a person plausibly has on their clipboard.

import { describe, expect, it } from 'vitest'

import {
  parseAcceleventsEventUrl,
  parseAcceleventsMapping,
} from '@/features/integrations/connection'

describe('parseAcceleventsEventUrl', () => {
  it('keeps a bare slug untouched, which is what the field asks for', () => {
    expect(parseAcceleventsEventUrl('my-conference-2026')).toBe('my-conference-2026')
  })

  it('takes the slug out of a full public address', () => {
    expect(parseAcceleventsEventUrl('https://events.accelevents.com/e/my-conference-2026')).toBe(
      'my-conference-2026',
    )
  })

  it('takes it out of a host console address too, past the fixed path word', () => {
    expect(
      parseAcceleventsEventUrl('https://www.accelevents.com/event/my-conference-2026/sessions'),
    ).toBe('my-conference-2026')
  })

  it('drops a query string and a fragment, which are never identity', () => {
    // An address copied out of a browser carries whatever tracking parameter was on it, and
    // a slug with a `?` on the end breaks every request path built from it.
    expect(parseAcceleventsEventUrl('https://events.accelevents.com/e/summit?utm_source=x')).toBe(
      'summit',
    )
    expect(parseAcceleventsEventUrl('summit#agenda')).toBe('summit')
  })

  it('handles a protocol-relative or host-prefixed path', () => {
    expect(parseAcceleventsEventUrl('//events.accelevents.com/e/summit')).toBe('summit')
    expect(parseAcceleventsEventUrl('events.accelevents.com/e/summit')).toBe('summit')
  })

  it('trims, and answers empty for input that names nothing', () => {
    expect(parseAcceleventsEventUrl('  summit  ')).toBe('summit')
    expect(parseAcceleventsEventUrl('')).toBe('')
    expect(parseAcceleventsEventUrl('   ')).toBe('')
    expect(parseAcceleventsEventUrl('https://')).toBe('')
  })

  it('does not mistake a slug that happens to contain a noise word for noise', () => {
    // `event-ops` is not the path segment `event`, and dropping it would map the organizer
    // to a different conference than the one they pasted.
    expect(parseAcceleventsEventUrl('event-ops-2026')).toBe('event-ops-2026')
  })
})

describe('parseAcceleventsMapping', () => {
  it('refuses an empty event URL with a message naming the shape wanted', () => {
    const result = parseAcceleventsMapping({ eventUrl: '   ', remoteEventId: '99' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('my-conference-2026')
  })

  it('accepts a mapping with no remote id, because the slug is what reads and writes', () => {
    const result = parseAcceleventsMapping({ eventUrl: 'summit', remoteEventId: '' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Absent rather than an empty string, so the mutation CLEARS the column instead of
    // storing a blank that later reads as "set to nothing".
    expect(result.mapping).toEqual({ eventUrl: 'summit', remoteEventId: undefined })
  })

  it('normalizes the URL and trims the id together', () => {
    const result = parseAcceleventsMapping({
      eventUrl: 'https://events.accelevents.com/e/summit',
      remoteEventId: ' 12345 ',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mapping).toEqual({ eventUrl: 'summit', remoteEventId: '12345' })
  })
})
