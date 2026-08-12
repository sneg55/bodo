// `/admin/[eventId]` accepts a record id OR a slug, and the whole safety of that rests on
// telling them apart exactly. Two failures are worth pinning because neither shows up as an
// error at runtime:
//
//   - a slug read as a record id 404s an event at its own URL
//   - a record id sent to the slug lookup costs a read and resolves to nothing
//
// The third case is the slug guard below: the one slug shape that IS a record id shape has
// to be unsaveable, or anchoring the pattern cannot help.

import { describe, expect, it } from 'vitest'

import { isEventRecordId, resolveEventRefWith } from '@/features/events/event-ref'
import { checkEventDetails } from '@/features/settings/checks'
import type { EventDetailsDraft } from '@/features/settings/draft'

const ID = 'recHnUyjJXap9POSM'

describe('isEventRecordId', () => {
  it('accepts a real record id', () => {
    expect(isEventRecordId(ID)).toBe(true)
  })

  it('rejects a slug that merely starts with rec', () => {
    // The case a `startsWith('rec')` test gets wrong, and it is an ordinary word.
    expect(isEventRecordId('recordings')).toBe(false)
    expect(isEventRecordId('recap-2026')).toBe(false)
  })

  it('rejects an ordinary event slug', () => {
    expect(isEventRecordId('ai-engineer-worlds-fair')).toBe(false)
  })

  it('is anchored at both ends', () => {
    expect(isEventRecordId(`${ID}/submissions`)).toBe(false)
    expect(isEventRecordId(`x${ID}`)).toBe(false)
    // `rec` plus 15, one too many.
    expect(isEventRecordId('recHnUyjJXap9POSMx')).toBe(false)
  })
})

describe('resolveEventRefWith', () => {
  it('resolves a record id to itself without reading', async () => {
    let calls = 0
    const resolved = await resolveEventRefWith(ID, (slug) => {
      calls += 1
      return Promise.resolve({ id: `unexpected-${slug}` })
    })

    expect(resolved).toBe(ID)
    // Not incidental: this is what keeps an existing rec-id URL working for an event whose
    // slug has since changed, and what keeps the resolution off the hot path.
    expect(calls).toBe(0)
  })

  it('resolves a slug through the lookup', async () => {
    const resolved = await resolveEventRefWith('ai-engineer-worlds-fair', (slug) =>
      Promise.resolve(slug === 'ai-engineer-worlds-fair' ? { id: ID } : undefined),
    )

    expect(resolved).toBe(ID)
  })

  it('returns undefined for a slug no event holds', async () => {
    const resolved = await resolveEventRefWith('not-an-event', () => Promise.resolve(undefined))

    expect(resolved).toBeUndefined()
  })
})

describe('the slug guard that closes the collision', () => {
  const draft = (slug: string): EventDetailsDraft => ({
    name: 'AI Engineer',
    slug,
    eventType: 'conference',
    websiteUrl: '',
    location: '',
    timezone: 'America/Los_Angeles',
    startsAt: '2026-10-12T16:00:00.000Z',
    endsAt: '2026-10-14T16:00:00.000Z',
    theme: '',
    logoUrl: '',
    backgroundUrl: '',
  })

  const slugProblems = (slug: string) =>
    checkEventDetails(draft(slug)).filter((problem) => problem.field === 'slug')

  it('refuses a slug shaped exactly like a record id', () => {
    // 17 characters, all lowercase, no hyphen: the only shape `isEventRecordId` would
    // mistake for an id, so an event saved under it would 404 at its own URL.
    expect(slugProblems('recabcdefghijklmn')).not.toHaveLength(0)
    expect(isEventRecordId('recabcdefghijklmn')).toBe(true)
  })

  it('still accepts an ordinary slug that begins with rec', () => {
    expect(slugProblems('recordings-2026')).toHaveLength(0)
  })

  it('accepts the slug that is one character short of the collision', () => {
    expect(slugProblems('recabcdefghijklm')).toHaveLength(0)
  })
})
