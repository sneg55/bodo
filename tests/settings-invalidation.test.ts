// The tag set an Event Details save expires.
//
// Pinned here because the failure it prevents is invisible in development and public in
// production: `getEventBySlug` caches under `eventSlugTag(slug)`, so a slug change that
// expires only one of the two slug tags leaves `/agenda/{oldSlug}` serving a page for an
// event that no longer answers there, or `/agenda/{newSlug}` serving the cached miss.

import { describe, expect, it } from 'vitest'

import { eventSettingsInvalidation, eventSettingsTags } from '@/features/settings/invalidation'

const UNCHANGED = {
  eventId: 'recEv1',
  previousSlug: 'ai-engineer-sandbox',
  nextSlug: 'ai-engineer-sandbox',
}
const RENAMED = { eventId: 'recEv1', previousSlug: 'ai-engineer-sandbox', nextSlug: 'aie-nyc-2026' }

describe('eventSettingsInvalidation', () => {
  it('expires the event record and its current slug on every save', () => {
    expect(eventSettingsInvalidation(UNCHANGED)).toEqual({
      own: ['event:recEv1', 'event:slug:ai-engineer-sandbox'],
      others: [],
    })
  })

  it('expires both the old and the new slug when the slug changes', () => {
    const tags = eventSettingsTags(RENAMED)
    expect(tags).toContain('event:slug:ai-engineer-sandbox')
    expect(tags).toContain('event:slug:aie-nyc-2026')
    expect(tags).toContain('event:recEv1')
  })

  it('never names the same tag twice, so a rename does not double expire', () => {
    const tags = eventSettingsTags(RENAMED)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('does not expire the agenda, which this write does not touch', () => {
    const tags = eventSettingsTags(RENAMED)
    expect(tags).not.toContain('event:recEv1:agenda')
    expect(tags).not.toContain('event:recEv1:agenda:published')
    expect(tags).not.toContain('event:recEv1:submissions')
  })

  it('normalises case and space before building a tag, so it matches what the read used', () => {
    expect(
      eventSettingsTags({ eventId: 'recEv1', previousSlug: ' AI-Engineer ', nextSlug: 'x-y' }),
    ).toContain('event:slug:ai-engineer')
  })
})
