import { describe, expect, it } from 'vitest'

import { SLUG_MAX_LENGTH, slugify, uniqueSlug, validateSlug } from '@/features/resources/slug'

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('Venue and Travel Info')).toBe('venue-and-travel-info')
  })

  it('drops punctuation rather than encoding it', () => {
    expect(slugify("Speaker's Guide (2026)!")).toBe('speakers-guide-2026')
  })

  it('collapses runs of separators and trims the edges', () => {
    expect(slugify('  --Wi-Fi   &   Power--  ')).toBe('wi-fi-power')
  })

  it('truncates to the length limit without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bbbb`)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('returns an empty string when a title carries no usable characters', () => {
    // The caller has to treat this as "no slug", not as a valid one. A resource with
    // an empty slug has no URL, so the action rejects it rather than storing it.
    expect(slugify('!!! ???')).toBe('')
  })
})

describe('validateSlug', () => {
  it('accepts a lowercase hyphenated slug', () => {
    expect(validateSlug('venue-info')).toEqual({ ok: true, slug: 'venue-info' })
  })

  it('accepts digits and normalises surrounding whitespace and case', () => {
    expect(validateSlug('  Venue-2026  ')).toEqual({ ok: true, slug: 'venue-2026' })
  })

  it('rejects an empty slug', () => {
    const result = validateSlug('   ')
    expect(result.ok).toBe(false)
  })

  it('rejects a slug with a slash so it cannot escape its own route segment', () => {
    const result = validateSlug('venue/../../admin')
    expect(result.ok).toBe(false)
  })

  it('rejects a slug with a percent escape', () => {
    expect(validateSlug('venue%2f').ok).toBe(false)
  })

  it('rejects a slug longer than the limit', () => {
    expect(validateSlug('a'.repeat(SLUG_MAX_LENGTH + 1)).ok).toBe(false)
  })

  it('rejects leading, trailing, and doubled hyphens', () => {
    expect(validateSlug('-venue').ok).toBe(false)
    expect(validateSlug('venue-').ok).toBe(false)
    expect(validateSlug('venue--info').ok).toBe(false)
  })
})

describe('uniqueSlug', () => {
  it('keeps the desired slug when nothing has taken it', () => {
    expect(uniqueSlug('venue', ['travel'])).toBe('venue')
  })

  it('suffixes the first free number on a collision', () => {
    expect(uniqueSlug('venue', ['venue'])).toBe('venue-2')
    expect(uniqueSlug('venue', ['venue', 'venue-2'])).toBe('venue-3')
  })

  it('skips a gap rather than reusing a taken suffix', () => {
    expect(uniqueSlug('venue', ['venue', 'venue-3'])).toBe('venue-2')
  })

  it('compares case-insensitively, because the stored slug is lowercased', () => {
    expect(uniqueSlug('venue', ['VENUE'])).toBe('venue-2')
  })

  it('leaves room for the suffix when the desired slug is at the limit', () => {
    const desired = 'a'.repeat(SLUG_MAX_LENGTH)
    const result = uniqueSlug(desired, [desired])
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(validateSlug(result).ok).toBe(true)
  })
})
