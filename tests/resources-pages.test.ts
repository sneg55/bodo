import { describe, expect, it } from 'vitest'

import {
  adminResourceEntries,
  findResourceBySlug,
  speakerResources,
} from '@/features/resources/pages'
import type { PortalItem, Resource } from '@/types/resources'

const EVENT = 'recEvent1'
const OTHER_EVENT = 'recEvent2'

function resource(over: Partial<Resource> & { id: string }): Resource {
  return {
    eventId: EVENT,
    title: over.id,
    slug: over.id,
    visibility: 'portal',
    order: 1,
    ...over,
  }
}

function item(over: Partial<PortalItem> & { id: string; resourceId: string }): PortalItem {
  return {
    eventId: EVENT,
    itemType: 'resource',
    enabled: true,
    order: 1,
    ...over,
  }
}

describe('speakerResources', () => {
  it('shows a resource whose portal item is enabled', () => {
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'venue' })],
      [item({ id: 'p1', resourceId: 'venue' })],
    )
    expect(rows.map((row) => row.slug)).toEqual(['venue'])
  })

  it('hides a resource with no portal item at all, because that is a draft', () => {
    expect(speakerResources(EVENT, [resource({ id: 'draft' })], [])).toEqual([])
  })

  it('hides a resource whose portal item is disabled', () => {
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'venue' })],
      [item({ id: 'p1', resourceId: 'venue', enabled: false })],
    )
    expect(rows).toEqual([])
  })

  it('shows a public resource too, since public is a superset of portal', () => {
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'code', visibility: 'public' })],
      [item({ id: 'p1', resourceId: 'code' })],
    )
    expect(rows.map((row) => row.slug)).toEqual(['code'])
  })

  it('never shows a resource belonging to another event', () => {
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'theirs', eventId: OTHER_EVENT })],
      [item({ id: 'p1', resourceId: 'theirs', eventId: OTHER_EVENT })],
    )
    expect(rows).toEqual([])
  })

  it('ignores an enabled item that belongs to another event', () => {
    // Belt and braces: the resource is ours, the publishing row is not. An item from
    // another event must not be able to publish a page into this portal.
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'venue' })],
      [item({ id: 'p1', resourceId: 'venue', eventId: OTHER_EVENT })],
    )
    expect(rows).toEqual([])
  })

  it('ignores a portal item that is not a resource item', () => {
    const rows = speakerResources(
      EVENT,
      [resource({ id: 'venue' })],
      [{ ...item({ id: 'p1', resourceId: 'venue' }), itemType: 'task' }],
    )
    expect(rows).toEqual([])
  })

  it('orders by the portal item order, then by title', () => {
    const rows = speakerResources(
      EVENT,
      [
        resource({ id: 'c', title: 'Code of Conduct' }),
        resource({ id: 'a', title: 'AV Setup' }),
        resource({ id: 'v', title: 'Venue' }),
      ],
      [
        item({ id: 'p1', resourceId: 'c', order: 2 }),
        item({ id: 'p2', resourceId: 'a', order: 2 }),
        item({ id: 'p3', resourceId: 'v', order: 1 }),
      ],
    )
    expect(rows.map((row) => row.title)).toEqual(['Venue', 'AV Setup', 'Code of Conduct'])
  })
})

describe('adminResourceEntries', () => {
  it('lists drafts alongside published pages, with their item attached', () => {
    const entries = adminResourceEntries(
      EVENT,
      [resource({ id: 'draft', order: 2 }), resource({ id: 'live', order: 1 })],
      [item({ id: 'p1', resourceId: 'live' })],
    )
    expect(entries.map((entry) => [entry.resource.slug, entry.item?.enabled ?? false])).toEqual([
      ['live', true],
      ['draft', false],
    ])
  })

  it('orders by the resource order, then by title, so the list never reshuffles', () => {
    const entries = adminResourceEntries(
      EVENT,
      [
        resource({ id: 'b', title: 'Bravo', order: 1 }),
        resource({ id: 'a', title: 'Alpha', order: 1 }),
      ],
      [],
    )
    expect(entries.map((entry) => entry.resource.title)).toEqual(['Alpha', 'Bravo'])
  })

  it('excludes resources belonging to another event', () => {
    const entries = adminResourceEntries(
      EVENT,
      [resource({ id: 'ours' }), resource({ id: 'theirs', eventId: OTHER_EVENT })],
      [],
    )
    expect(entries.map((entry) => entry.resource.id)).toEqual(['ours'])
  })
})

describe('findResourceBySlug', () => {
  const rows = [resource({ id: 'venue', slug: 'venue-info' })]

  it('finds a page by its exact slug', () => {
    expect(findResourceBySlug(rows, 'venue-info')?.id).toBe('venue')
  })

  it('matches case-insensitively, because a pasted URL may be capitalised', () => {
    expect(findResourceBySlug(rows, 'Venue-Info')?.id).toBe('venue')
  })

  it('returns undefined for an unknown slug so the page can 404', () => {
    expect(findResourceBySlug(rows, 'nope')).toBeUndefined()
  })
})
