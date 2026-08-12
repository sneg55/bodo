// Resources and PortalItems, mapped from Airtable's own shape and built back into it.
//
// Written by hand in wire shape rather than round-tripped through the field builders, for
// the same reason tests/airtable-mapping-portal.test.ts is: a round trip agrees with itself
// even when both halves are wrong.
//
// The cases that matter are the two defaults and the one clearing rule, because each is a
// place where being wrong is invisible from the admin side: a blank `enabled` publishing a
// draft to every speaker, a blank `visibility` widening an organizer's intent, and an
// omitted `embedHtml` key leaving deleted markup rendering in the portal.

import { describe, expect, it } from 'vitest'

import { isAppError } from '@/constants/errorIds'
import { mapPortalItem, mapResource } from '@/services/airtable/mapping-resources'
import type { AirtableRecord } from '@/services/airtable/records'
import {
  portalItemFields,
  portalItemUpdateFields,
  resourceEditFields,
  resourceFields,
} from '@/services/airtable/to-fields-resources'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(fn: () => unknown): string {
  try {
    fn()
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
}

const RESOURCE_CORE = { event: ['recEvent1'], title: 'Venue and travel', slug: 'venue-and-travel' }

describe('mapResource', () => {
  it('collapses the event link and reads the whole row', () => {
    expect(
      mapResource(
        record('recRes1', {
          ...RESOURCE_CORE,
          bodyMarkdown: '# Getting here',
          embedHtml: '<iframe src="https://maps.example.com"></iframe>',
          visibility: 'public',
          order: 3,
        }),
      ),
    ).toEqual({
      id: 'recRes1',
      eventId: 'recEvent1',
      title: 'Venue and travel',
      slug: 'venue-and-travel',
      bodyMarkdown: '# Getting here',
      embedHtml: '<iframe src="https://maps.example.com"></iframe>',
      visibility: 'public',
      order: 3,
    })
  })

  it('leaves an empty body and embed absent rather than empty strings', () => {
    const resource = mapResource(record('recRes1', RESOURCE_CORE))
    expect(resource.bodyMarkdown).toBeUndefined()
    expect(resource.embedHtml).toBeUndefined()
  })

  it('reads a blank visibility as portal, the narrower of the two values', () => {
    expect(mapResource(record('recRes1', RESOURCE_CORE)).visibility).toBe('portal')
  })

  it('reads a blank order as 0 rather than dropping the row', () => {
    expect(mapResource(record('recRes1', RESOURCE_CORE)).order).toBe(0)
  })

  it('stores hostile embed markup exactly as an organizer pasted it', () => {
    // Nothing is stripped on read. Sanitizing here would mean the stored value is no longer
    // what was written, and the defense is the render-time iframe sandbox instead.
    const payload = '<script>alert(1)</script>'
    expect(mapResource(record('recRes1', { ...RESOURCE_CORE, embedHtml: payload })).embedHtml).toBe(
      payload,
    )
  })

  it('refuses a row with no title, slug, or event link', () => {
    expect(errorId(() => mapResource(record('recRes1', { event: ['recEvent1'], slug: 'x' })))).toBe(
      'E_DATA_002',
    )
    expect(
      errorId(() => mapResource(record('recRes1', { event: ['recEvent1'], title: 'x' }))),
    ).toBe('E_DATA_002')
    // A missing event link is a SHAPE failure, not DATA_MISSING_LINK: `requiredLink` goes
    // through `shapeError`, and the row is malformed rather than pointing at a gone record.
    expect(errorId(() => mapResource(record('recRes1', { title: 'x', slug: 'x' })))).toBe(
      'E_DATA_002',
    )
  })
})

describe('mapPortalItem', () => {
  it('reads a resource row with its link and flag', () => {
    expect(
      mapPortalItem(
        record('recItem1', {
          event: ['recEvent1'],
          itemType: 'resource',
          resource: ['recRes1'],
          enabled: true,
          order: 2,
        }),
      ),
    ).toEqual({
      id: 'recItem1',
      eventId: 'recEvent1',
      itemType: 'resource',
      taskId: undefined,
      formId: undefined,
      fileRequestId: undefined,
      resourceId: 'recRes1',
      enabled: true,
      order: 2,
    })
  })

  it('reads a blank checkbox as not published', () => {
    // An unchecked box and a never-touched box are the same value here, and both mean
    // draft. Defaulting the other way would publish an unfinished page.
    const item = mapPortalItem(
      record('recItem1', { event: ['recEvent1'], itemType: 'resource', resource: ['recRes1'] }),
    )
    expect(item.enabled).toBe(false)
  })

  it('refuses a row with no itemType, since that is what names the real link', () => {
    expect(
      errorId(() =>
        mapPortalItem(record('recItem1', { event: ['recEvent1'], resource: ['recRes1'] })),
      ),
    ).toBe('E_DATA_002')
  })
})

describe('resourceFields', () => {
  it('sends the event as a link array and omits what is absent', () => {
    expect(
      resourceFields({
        eventId: 'recEvent1',
        title: 'Speaker guide',
        slug: 'speaker-guide',
        visibility: 'portal',
        order: 1,
      }),
    ).toEqual({
      title: 'Speaker guide',
      event: ['recEvent1'],
      slug: 'speaker-guide',
      visibility: 'portal',
      order: 1,
    })
  })
})

describe('resourceEditFields', () => {
  it('clears the body and embed when they are emptied, rather than leaving them in place', () => {
    // The direction that matters: an organizer who deletes the embed and saves must not
    // have it keep rendering to speakers.
    expect(
      resourceEditFields({
        title: 'Speaker guide',
        slug: 'speaker-guide',
        bodyMarkdown: '',
        embedHtml: '   ',
        visibility: 'portal',
        order: 1,
      }),
    ).toEqual({
      title: 'Speaker guide',
      slug: 'speaker-guide',
      bodyMarkdown: null,
      embedHtml: null,
      visibility: 'portal',
      order: 1,
    })
  })

  it('never re-sends the event link, so a bad event id cannot re-parent a page', () => {
    const fields = resourceEditFields({
      title: 'x',
      slug: 'x',
      visibility: 'portal',
      order: 0,
    })
    expect(Object.keys(fields)).not.toContain('event')
  })
})

describe('portalItemFields', () => {
  it('writes only the resource link, and always writes enabled', () => {
    expect(
      portalItemFields({
        eventId: 'recEvent1',
        itemType: 'resource',
        resourceId: 'recRes1',
        enabled: false,
        order: 4,
      }),
    ).toEqual({
      order: 4,
      event: ['recEvent1'],
      itemType: 'resource',
      resource: ['recRes1'],
      enabled: false,
    })
  })

  it('updates only the two columns a publication change owns', () => {
    expect(portalItemUpdateFields({ enabled: true, order: 2 })).toEqual({
      enabled: true,
      order: 2,
    })
  })
})
