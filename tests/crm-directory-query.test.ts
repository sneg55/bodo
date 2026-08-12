// The directory's URL codec. Everything here is what an organizer can type into the
// address bar, so every case is a malformed value that must not throw.

import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { buildCrmSearch, type CrmQueryState, parseCrmQuery } from '@/features/crm/directory-query'

const DEFAULTS: CrmQueryState = {
  search: '',
  sort: null,
  filters: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  duplicatesOnly: false,
}

describe('parseCrmQuery', () => {
  it('defaults an empty address bar', () => {
    expect(parseCrmQuery({})).toEqual(DEFAULTS)
  })

  it('sorts on a derived count, which the Abstracts codec would refuse', () => {
    // The difference is where the query runs: Airtable cannot order by a column that does
    // not exist, but this surface orders in memory over the row model, so a count is a
    // legal sort key here.
    expect(parseCrmQuery({ sort: 'eventCount~desc' }).sort).toEqual({
      key: 'eventCount',
      direction: 'desc',
    })
  })

  it('drops a sort on a key the directory does not offer', () => {
    expect(parseCrmQuery({ sort: 'track~asc' }).sort).toBeNull()
  })

  it('drops a filter on a key the directory does not offer', () => {
    expect(parseCrmQuery({ f: 'room~is~Hall A' }).filters).toEqual([])
  })

  it('carries a tag filter, which is a column no Airtable formula could filter on', () => {
    expect(parseCrmQuery({ f: 'tags~contains~Keynote' }).filters).toEqual([
      { id: 'f0', key: 'tags', operator: 'contains', value: 'Keynote' },
    ])
  })

  it('drops a filter whose operator is not one of ours', () => {
    expect(parseCrmQuery({ f: 'company~matches~Acme' }).filters).toEqual([])
  })

  it('keeps a separator inside a filter value', () => {
    expect(parseCrmQuery({ f: 'tagline~contains~a~b' }).filters).toEqual([
      { id: 'f0', key: 'tagline', operator: 'contains', value: 'a~b' },
    ])
  })

  it('reads repeated filter keys as several filters', () => {
    expect(parseCrmQuery({ f: ['company~is~Acme', 'email~contains~@example.com'] })).toMatchObject({
      filters: [
        { id: 'f0', key: 'company', operator: 'is', value: 'Acme' },
        { id: 'f1', key: 'email', operator: 'contains', value: '@example.com' },
      ],
    })
  })

  it('falls back on a page that is not a positive integer', () => {
    expect(parseCrmQuery({ page: '0' }).page).toBe(1)
    expect(parseCrmQuery({ page: 'two' }).page).toBe(1)
    expect(parseCrmQuery({ page: '2' }).page).toBe(2)
  })

  it('refuses a page size the footer does not offer', () => {
    expect(parseCrmQuery({ size: '37' }).pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(parseCrmQuery({ size: '100' }).pageSize).toBe(100)
  })
})

describe('buildCrmSearch', () => {
  it('omits every key that is at its default, so a pristine visit has a clean URL', () => {
    expect(buildCrmSearch(DEFAULTS, {})).toBe('')
  })

  it('round-trips through the parser', () => {
    const state: CrmQueryState = {
      search: 'ada',
      sort: { key: 'sessionCount', direction: 'desc' },
      filters: [{ id: 'f0', key: 'company', operator: 'contains', value: 'Engines' }],
      page: 3,
      pageSize: 50,
      duplicatesOnly: true,
    }
    const search = buildCrmSearch(state, {})
    const params = Object.fromEntries(new URLSearchParams(search))
    expect(parseCrmQuery(params)).toEqual(state)
  })

  it('resets the page when the result set changes', () => {
    expect(buildCrmSearch({ ...DEFAULTS, page: 4 }, { search: 'ada' })).toBe('?q=ada')
  })

  it('keeps the page when the patch names one', () => {
    expect(buildCrmSearch({ ...DEFAULTS, page: 4 }, { page: 2 })).toBe('?page=2')
  })

  it('keeps the page when only the sort changed, because sorting does not requery', () => {
    // Asserted by parsing it back rather than against the literal string: how
    // `URLSearchParams` encodes the `~` separator is its business, not this module's, and
    // pinning the encoded form makes this test fail on a change that breaks nothing.
    const search = buildCrmSearch(
      { ...DEFAULTS, page: 2 },
      { sort: { key: 'name', direction: 'asc' } },
    )
    expect(parseCrmQuery(Object.fromEntries(new URLSearchParams(search)))).toMatchObject({
      sort: { key: 'name', direction: 'asc' },
      page: 2,
    })
  })
})
