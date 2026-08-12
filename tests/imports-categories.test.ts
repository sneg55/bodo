// Category suggestions, and the line between suggesting and applying.
//
// The suggestion is a convenience. The confirmation is the feature: Sessionize category
// titles are user-named, so a guess applied without the organizer's confirmation can
// turn an event's Track taxonomy into tags and be discovered only after the run wrote
// everything. `targetFor` returning undefined for an unconfirmed category is the whole
// guarantee, so it is tested from both directions.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SESSION_TARGET,
  DEFAULT_SPEAKER_TARGET,
  isMappingComplete,
  previewCategories,
  suggestCategoryTarget,
  suggestedMapping,
  targetFor,
} from '@/features/imports/categories'
import { EMPTY_IMPORT_MAPPING } from '@/types/imports'

const DEMO = [
  { id: '1', title: 'Session format', type: 'session' as const, items: [{}, {}] },
  { id: '2', title: 'Track', type: 'session' as const, items: [{}] },
  { id: '3', title: 'Level', type: 'session' as const, items: [{}] },
  { id: '4', title: 'Language', type: 'session' as const, items: [{}] },
]

describe('suggestCategoryTarget', () => {
  it("guesses the demo event's four titles", () => {
    expect(suggestCategoryTarget('Session format')).toBe('format')
    expect(suggestCategoryTarget('Track')).toBe('track')
    expect(suggestCategoryTarget('Level')).toBe('level')
    expect(suggestCategoryTarget('Language')).toBe('language')
  })

  it('reads `Session format` as format and not as a type', () => {
    // Rule order is load-bearing: `Session format` contains both "session" and "format",
    // and matching "type" first would send every format category to the wrong concept.
    expect(suggestCategoryTarget('Session Format')).toBe('format')
    expect(suggestCategoryTarget('Session type')).toBe('format')
  })

  it('tolerates the wording organizers actually use', () => {
    expect(suggestCategoryTarget('Primary Track')).toBe('track')
    expect(suggestCategoryTarget('  audience   level  ')).toBe('level')
    expect(suggestCategoryTarget('Spoken Language')).toBe('language')
  })

  it('falls back to tag for a session category it does not know', () => {
    expect(suggestCategoryTarget('Sponsor tier')).toBe(DEFAULT_SESSION_TARGET)
    expect(suggestCategoryTarget('')).toBe(DEFAULT_SESSION_TARGET)
    expect(DEFAULT_SESSION_TARGET).toBe('tag')
  })

  it('ignores speaker categories by default, because bodo has no speaker taxonomy', () => {
    expect(suggestCategoryTarget('Track', 'speaker')).toBe(DEFAULT_SPEAKER_TARGET)
    expect(DEFAULT_SPEAKER_TARGET).toBe('ignore')
  })
})

describe('previewCategories', () => {
  it('carries the item count and the suggestion for the mapping step', () => {
    expect(previewCategories(DEMO)).toEqual([
      { id: '1', title: 'Session format', itemCount: 2, suggested: 'format' },
      { id: '2', title: 'Track', itemCount: 1, suggested: 'track' },
      { id: '3', title: 'Level', itemCount: 1, suggested: 'level' },
      { id: '4', title: 'Language', itemCount: 1, suggested: 'language' },
    ])
  })
})

describe('a suggestion is never applied on its own', () => {
  it('resolves nothing for a category the organizer has not confirmed', () => {
    expect(targetFor(EMPTY_IMPORT_MAPPING, '2')).toBeUndefined()
    // Even though the title would have guessed `track`. The guess lives in
    // suggestedMapping, which only pre-fills the wizard's Selects.
    expect(suggestCategoryTarget('Track')).toBe('track')
  })

  it('resolves only what the confirmed mapping holds', () => {
    const confirmed = { categories: { '2': 'tag' as const } }

    expect(targetFor(confirmed, '2')).toBe('tag')
    expect(targetFor(confirmed, '1')).toBeUndefined()
  })

  it('pre-fills every category so the common case is a glance and a click', () => {
    const mapping = suggestedMapping(DEMO)

    expect(mapping.categories).toEqual({
      '1': 'format',
      '2': 'track',
      '3': 'level',
      '4': 'language',
    })
    expect(isMappingComplete(mapping, DEMO)).toBe(true)
  })

  it('is incomplete while any category is unanswered', () => {
    expect(isMappingComplete({ categories: { '1': 'format' } }, DEMO)).toBe(false)
    expect(isMappingComplete(EMPTY_IMPORT_MAPPING, DEMO)).toBe(false)
    expect(isMappingComplete(EMPTY_IMPORT_MAPPING, [])).toBe(true)
  })
})
