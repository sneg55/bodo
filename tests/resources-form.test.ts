import { describe, expect, it } from 'vitest'

import {
  LONG_TEXT_MAX_LENGTH,
  parseResourceForm,
  resolveSlug,
  resourceFormValues,
  TITLE_MAX_LENGTH,
} from '@/features/resources/form'
import type { Resource } from '@/types/resources'

function problems(posted: Parameters<typeof parseResourceForm>[0]): readonly string[] {
  const result = parseResourceForm(posted)
  return result.ok ? [] : result.problems.map((problem) => problem.field)
}

describe('parseResourceForm', () => {
  it('accepts a filled form and normalises the slug', () => {
    const result = parseResourceForm({
      title: '  Venue and Travel  ',
      slug: ' Venue-Info ',
      bodyMarkdown: '# Hi',
      embedHtml: '<iframe src="https://example.com"></iframe>',
      visibility: 'public',
      order: '3',
      enabled: 'on',
    })
    expect(result).toEqual({
      ok: true,
      values: {
        title: 'Venue and Travel',
        slug: 'venue-info',
        bodyMarkdown: '# Hi',
        embedHtml: '<iframe src="https://example.com"></iframe>',
        visibility: 'public',
        order: 3,
        enabled: true,
      },
    })
  })

  it('derives the slug from the title when the field is left blank', () => {
    const result = parseResourceForm({ title: 'Green Room Notes', order: '1' })
    expect(result.ok && result.values.slug).toBe('green-room-notes')
  })

  it('stores the embed exactly as pasted, hostile or not', () => {
    // Nothing is stripped on the way in. The embed is isolated at render, and rewriting
    // it here would mean the stored value is no longer what the organizer wrote.
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    const result = parseResourceForm({ title: 'Embed', embedHtml: payload })
    expect(result.ok && result.values.embedHtml).toBe(payload)
  })

  it('defaults an absent visibility to portal, the narrower value', () => {
    const result = parseResourceForm({ title: 'Guide' })
    expect(result.ok && result.values.visibility).toBe('portal')
  })

  it('treats an absent enabled checkbox as not published', () => {
    const result = parseResourceForm({ title: 'Guide' })
    expect(result.ok && result.values.enabled).toBe(false)
  })

  it('treats a blank order as 0 rather than a validation failure', () => {
    const result = parseResourceForm({ title: 'Guide', order: '' })
    expect(result.ok && result.values.order).toBe(0)
  })

  it('reports a missing title', () => {
    expect(problems({ title: '   ' })).toContain('title')
  })

  it('reports an over-long title', () => {
    expect(problems({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) })).toContain('title')
  })

  it('reports an over-long body and embed', () => {
    const tooLong = 'a'.repeat(LONG_TEXT_MAX_LENGTH + 1)
    expect(problems({ title: 'Guide', bodyMarkdown: tooLong })).toContain('bodyMarkdown')
    expect(problems({ title: 'Guide', embedHtml: tooLong })).toContain('embedHtml')
  })

  it('reports a slug that is not a usable path segment', () => {
    expect(problems({ title: 'Guide', slug: 'venue/info' })).toContain('slug')
    expect(problems({ title: 'Guide', slug: 'Venue Info' })).toContain('slug')
  })

  it('reports a title that cannot produce a slug, instead of storing an unreachable page', () => {
    expect(problems({ title: '???' })).toEqual(['slug'])
  })

  it('reports a non-integer or negative order', () => {
    expect(problems({ title: 'Guide', order: '1.5' })).toContain('order')
    expect(problems({ title: 'Guide', order: '-1' })).toContain('order')
    expect(problems({ title: 'Guide', order: 'first' })).toContain('order')
  })

  it('reports a visibility outside the schema vocabulary', () => {
    expect(problems({ title: 'Guide', visibility: 'everyone' })).toContain('visibility')
  })

  it('collects every problem at once rather than stopping at the first', () => {
    expect([...problems({ title: '', slug: 'bad slug', order: 'x' })].sort()).toEqual([
      'order',
      'slug',
      'title',
    ])
  })
})

describe('resolveSlug', () => {
  it('keeps a free slug', () => {
    expect(resolveSlug({ desired: 'venue', taken: ['guide'] })).toBe('venue')
  })

  it('suffixes a slug another page already holds', () => {
    expect(resolveSlug({ desired: 'venue', taken: ['venue'] })).toBe('venue-2')
  })

  it('does not renumber a page that is keeping its own slug', () => {
    // Without this, every save of an unchanged page would walk venue -> venue-2 ->
    // venue-3 and break links the organizer had already shared.
    expect(resolveSlug({ desired: 'venue', taken: ['venue'], currentSlug: 'venue' })).toBe('venue')
  })

  it('still suffixes when an edit moves a page onto a slug another page holds', () => {
    expect(resolveSlug({ desired: 'guide', taken: ['guide', 'venue'], currentSlug: 'venue' })).toBe(
      'guide-2',
    )
  })
})

describe('resourceFormValues', () => {
  const resource: Resource = {
    id: 'rec1',
    eventId: 'recEvent1',
    title: 'Venue',
    slug: 'venue',
    bodyMarkdown: 'body',
    embedHtml: '<b>x</b>',
    visibility: 'public',
    order: 4,
  }

  it('fills the editor from an existing page and its publication state', () => {
    expect(resourceFormValues({ resource, enabled: true, nextOrder: 9 })).toEqual({
      title: 'Venue',
      slug: 'venue',
      bodyMarkdown: 'body',
      embedHtml: '<b>x</b>',
      visibility: 'public',
      order: 4,
      enabled: true,
    })
  })

  it('starts a new page unpublished, at the end of the list', () => {
    expect(resourceFormValues({ enabled: false, nextOrder: 7 })).toEqual({
      title: '',
      slug: '',
      bodyMarkdown: '',
      embedHtml: '',
      visibility: 'portal',
      order: 7,
      enabled: false,
    })
  })
})
