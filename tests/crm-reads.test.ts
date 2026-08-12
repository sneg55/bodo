import { describe, expect, it } from 'vitest'

import { speakerListFilters } from '@/services/airtable/mapping-crm'

describe('speakerListFilters', () => {
  it('reads a stored DataTableFilter array', () => {
    const json = JSON.stringify([{ id: 'f1', key: 'company', operator: 'is', value: 'ACME' }])
    expect(speakerListFilters(json)).toEqual([
      { id: 'f1', key: 'company', operator: 'is', value: 'ACME' },
    ])
  })

  it('returns nothing for malformed JSON rather than throwing', () => {
    // A list that cannot be parsed must degrade to "no filter", not break the whole page.
    expect(speakerListFilters('{not json')).toEqual([])
  })

  it('drops entries with an unknown operator', () => {
    const json = JSON.stringify([{ id: 'f1', key: 'company', operator: 'explodes', value: 'x' }])
    expect(speakerListFilters(json)).toEqual([])
  })

  it('returns nothing for a payload that is not an array', () => {
    expect(speakerListFilters(JSON.stringify({ id: 'f1' }))).toEqual([])
  })

  it('returns nothing for an empty string', () => {
    // What a blank definitionJson cell maps to before this function ever sees it.
    expect(speakerListFilters('')).toEqual([])
  })

  it('returns nothing when the array contains null', () => {
    const json = JSON.stringify([{ id: 'f1', key: 'company', operator: 'is', value: 'x' }, null])
    expect(speakerListFilters(json)).toEqual([])
  })

  it('returns nothing when an entry is missing a required field', () => {
    const json = JSON.stringify([{ id: 'f1', operator: 'is', value: 'x' }])
    expect(speakerListFilters(json)).toEqual([])
  })
})
