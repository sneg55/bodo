import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE_SIZE } from '@/components/primitives/data-table-types'
import { ALL_TAB_ID } from '@/features/review/abstracts-filter'
import {
  buildAbstractsSearch,
  hasQueryState,
  parseAbstractsQuery,
} from '@/features/review/abstracts-query'

describe('parseAbstractsQuery', () => {
  it('defaults to All Abstracts, no search, no sort, page 1', () => {
    expect(parseAbstractsQuery({})).toEqual({
      tabId: ALL_TAB_ID,
      search: '',
      sort: null,
      filters: [],
      trackId: undefined,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    })
  })

  it('reads a sort, a track, and a page', () => {
    const query = parseAbstractsQuery({ sort: 'title~desc', track: 'trk1', page: '3' })
    expect(query.sort).toEqual({ key: 'title', direction: 'desc' })
    expect(query.trackId).toBe('trk1')
    expect(query.page).toBe(3)
  })

  it('drops a sort on a key nothing can produce a value for', () => {
    expect(parseAbstractsQuery({ sort: 'notARealField~asc' }).sort).toBeNull()
  })

  it('keeps a sort on a derived column, which is where this used to lie', () => {
    // Ratings is computed from `Reviews` and has no Submissions column, so the old test
    // for `column === true` threw this away: the header wrote `?sort=ratings~asc` into the
    // URL and nothing read it, so rows never moved and the arrow never toggled. Ranking by
    // score is the one thing a chair most wants from this table.
    expect(parseAbstractsQuery({ sort: 'ratings~desc' }).sort).toEqual({
      key: 'ratings',
      direction: 'desc',
    })
    // Same for `description`, which lives in `answersJson`. Airtable cannot sort inside a
    // JSON blob, and it is not being asked to: the sort runs in code over rows already
    // loaded, and `rowText` answers for this key.
    expect(parseAbstractsQuery({ sort: 'description~asc' }).sort).toEqual({
      key: 'description',
      direction: 'asc',
    })
  })

  it('reads repeated filter params and keeps a value containing the separator', () => {
    const query = parseAbstractsQuery({
      f: ['status~is~pending', 'title~contains~a~b'],
    })
    expect(query.filters).toEqual([
      { id: 'f0', key: 'status', operator: 'is', value: 'pending' },
      { id: 'f1', key: 'title', operator: 'contains', value: 'a~b' },
    ])
  })

  it('drops a filter with an operator the table does not implement', () => {
    expect(parseAbstractsQuery({ f: 'status~regex~x' }).filters).toEqual([])
  })

  it('falls back rather than throwing on any malformed number', () => {
    expect(parseAbstractsQuery({ page: 'abc' }).page).toBe(1)
    expect(parseAbstractsQuery({ page: '-4' }).page).toBe(1)
    // An unoffered page size is refused: it is a Select with three options, not free input.
    expect(parseAbstractsQuery({ size: '7' }).pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(parseAbstractsQuery({ size: '50' }).pageSize).toBe(50)
  })
})

describe('buildAbstractsSearch', () => {
  const base = parseAbstractsQuery({})

  it('omits every default, so the clean view has a clean URL', () => {
    expect(buildAbstractsSearch(base, {})).toBe('')
  })

  it('round-trips through the parser', () => {
    const search = buildAbstractsSearch(base, {
      tabId: 'pending',
      search: 'agents',
      sort: { key: 'title', direction: 'desc' },
      filters: [{ id: 'f0', key: 'status', operator: 'is', value: 'pending' }],
      trackId: 'trk1',
      pageSize: 50,
    })
    const params = Object.fromEntries(new URLSearchParams(search))
    const reparsed = parseAbstractsQuery(params)
    expect(reparsed).toMatchObject({
      tabId: 'pending',
      search: 'agents',
      sort: { key: 'title', direction: 'desc' },
      trackId: 'trk1',
      pageSize: 50,
    })
  })

  it('resets to page 1 when the result set changes underneath', () => {
    const onPageFour = { ...base, page: 4 }
    expect(buildAbstractsSearch(onPageFour, { tabId: 'pending' })).not.toContain('page=')
    expect(buildAbstractsSearch(onPageFour, { search: 'x' })).not.toContain('page=')
    expect(buildAbstractsSearch(onPageFour, { pageSize: 50 })).not.toContain('page=')
  })

  it('keeps the page when only the sort changes, since the set is the same rows', () => {
    const onPageFour = { ...base, page: 4 }
    expect(
      buildAbstractsSearch(onPageFour, { sort: { key: 'title', direction: 'asc' } }),
    ).toContain('page=4')
  })

  it('honours an explicit page even alongside a result-set change', () => {
    expect(buildAbstractsSearch(base, { tabId: 'pending', page: 2 })).toContain('page=2')
  })
})

describe('hasQueryState', () => {
  // This is what decides whether the Saved Views default gets applied. It has to answer
  // "did the address bar carry state", not "does the parsed query differ from the
  // defaults": a URL an organizer landed on by clearing every filter parses identically to
  // a pristine one, and re-applying the default over it would undo what they just did.
  it('is false for a pristine visit', () => {
    expect(hasQueryState({})).toBe(false)
  })

  it('is true for any table key, including ones that parse back to a default', () => {
    expect(hasQueryState({ tab: 'pending' })).toBe(true)
    expect(hasQueryState({ q: '' })).toBe(true)
    expect(hasQueryState({ f: [] })).toBe(false)
    expect(hasQueryState({ f: ['status~is~pending'] })).toBe(true)
    // A key that is not one of ours, e.g. a campaign tag on a shared link, is not state.
    expect(hasQueryState({ utm_source: 'slack' })).toBe(false)
  })
})
