// The subscribe URL. Small, and worth pinning because getting the SCHEME wrong produces a
// control that appears to work: the speaker clicks it, a file downloads, a calendar imports a
// frozen copy of today's agenda, and nobody discovers it is stale until the rooms move.

import { describe, expect, it } from 'vitest'

import { EMBED_SPEAKER_PARAM } from '@/features/cms/deep-link'
import { calendarFeedUrl, calendarSubscriptionUrl } from '@/features/portal/calendar-subscription'

const input = { appUrl: 'https://bodo.example.com', publicId: 'abc123', speakerId: 'recSpeaker1' }

describe('calendarSubscriptionUrl', () => {
  it('uses the webcal scheme so a calendar subscribes instead of downloading', () => {
    expect(calendarSubscriptionUrl(input).startsWith('webcal://')).toBe(true)
  })

  it('does not leave the original scheme inside the URL', () => {
    // The bug a naive `webcal://${url}` produces: `webcal://https://bodo.example.com/...`
    expect(calendarSubscriptionUrl(input)).not.toContain('https')
    expect(calendarSubscriptionUrl({ ...input, appUrl: 'http://localhost:3000' })).not.toContain(
      'http://',
    )
  })

  it('keeps the host, the path and the speaker parameter', () => {
    const url = calendarSubscriptionUrl(input)

    expect(url).toContain('bodo.example.com')
    expect(url).toContain('/embed/abc123.ics')
    expect(url).toContain(`${EMBED_SPEAKER_PARAM}=recSpeaker1`)
  })

  it('survives a port on the origin', () => {
    expect(calendarSubscriptionUrl({ ...input, appUrl: 'http://localhost:3000' })).toContain(
      'localhost:3000',
    )
  })
})

describe('calendarFeedUrl', () => {
  it('is the same feed over https, for clients with no webcal handler', () => {
    const feed = calendarFeedUrl(input)

    expect(feed.startsWith('https://bodo.example.com/embed/abc123.ics')).toBe(true)
    expect(feed).toContain(`${EMBED_SPEAKER_PARAM}=recSpeaker1`)
  })

  it('addresses the same resource as the subscribe form', () => {
    const subscribe = calendarSubscriptionUrl(input)
    const feed = calendarFeedUrl(input)

    expect(subscribe.replace('webcal://', '')).toBe(feed.replace('https://', ''))
  })
})
