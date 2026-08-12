import { describe, expect, it } from 'vitest'

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import {
  ALL_TAB_ID,
  abstractTabs,
  filterAbstractRows,
  pageAbstractRows,
  sortAbstractRows,
  sortValue,
  statusCounts,
} from '@/features/review/abstracts-filter'
import type { AbstractRow } from '@/features/review/abstracts-rows'
import type { RatingCell } from '@/features/review/ratings'

const NO_DATES = { notifiedAt: '', submittedAt: '', startsAt: '', endsAt: '' }

function row(overrides: Partial<AbstractRow> & { id: string }): AbstractRow {
  return {
    code: 'SESS-1',
    title: 'A talk',
    status: 'pending',
    reviewRequired: true,
    sourceLabel: 'Session Submission Form',
    description: '',
    dates: NO_DATES,
    scheduleStatus: 'unscheduled',
    tags: [],
    speakers: [],
    chairpersons: [],
    submitterEmail: '',
    rating: { kind: 'none' },
    ...overrides,
  }
}

const scored = (percent: number): RatingCell => ({
  kind: 'scored',
  percent,
  reviewCount: 2,
  recommendations: { yes: 2, no: 0, maybe: 0 },
})

describe('status tabs', () => {
  const rows = [
    row({ id: 's1', status: 'pending' }),
    row({ id: 's2', status: 'pending' }),
    row({ id: 's3', status: 'accepted' }),
    row({ id: 's4', status: 'draft' }),
  ]

  it('counts every status in the vocabulary, including the empty ones', () => {
    const counts = statusCounts(rows)
    expect(counts.get('pending')).toBe(2)
    expect(counts.get('withdrawn')).toBe(0)
  })

  it('renders the product tab order with All Abstracts first and Drafts last', () => {
    const tabs = abstractTabs(rows)
    expect(tabs.map((tab) => tab.label)).toEqual([
      'All Abstracts',
      'Accepted',
      'Accept Queue',
      'Pending',
      'Decline Queue',
      'Declined',
      'Withdrawn',
      'Drafts',
    ])
    expect(tabs[0]).toMatchObject({ id: ALL_TAB_ID, count: 4 })
  })
})

describe('filterAbstractRows', () => {
  const rows = [
    row({
      id: 's1',
      status: 'pending',
      title: 'Evaluating agents',
      track: { id: 'trk1', name: 'Agents', color: '#1' },
    }),
    row({
      id: 's2',
      status: 'accepted',
      title: 'Retrieval at scale',
      track: { id: 'trk2', name: 'Infra', color: '#2' },
    }),
    row({ id: 's3', status: 'pending', title: 'Draft thoughts' }),
  ]

  it('filters by tab, and All Abstracts filters nothing', () => {
    expect(filterAbstractRows(rows, query({ tabId: 'pending' })).map((r) => r.id)).toEqual([
      's1',
      's3',
    ])
    expect(filterAbstractRows(rows, query({})).length).toBe(3)
  })

  it('filters by track record id, not by track name', () => {
    expect(filterAbstractRows(rows, query({ trackId: 'trk2' })).map((r) => r.id)).toEqual(['s2'])
    // An empty string is "all tracks", which is what the toolbar Select sends on reset.
    expect(filterAbstractRows(rows, query({ trackId: '' })).length).toBe(3)
  })

  it('searches case-insensitively across the searchable columns', () => {
    expect(filterAbstractRows(rows, query({ search: 'RETRIEVAL' })).map((r) => r.id)).toEqual([
      's2',
    ])
    expect(filterAbstractRows(rows, query({ search: '   ' })).length).toBe(3)
  })

  it('applies each filter operator', () => {
    const cases: readonly [DataTableFilter, readonly string[]][] = [
      [filter({ key: 'status', operator: 'is', value: 'accepted' }), ['s2']],
      [filter({ key: 'status', operator: 'is_not', value: 'accepted' }), ['s1', 's3']],
      [filter({ key: 'title', operator: 'contains', value: 'agents' }), ['s1']],
      [filter({ key: 'track', operator: 'is_empty', value: '' }), ['s3']],
      [filter({ key: 'track', operator: 'is_not_empty', value: '' }), ['s1', 's2']],
    ]
    for (const [entry, expected] of cases) {
      expect(filterAbstractRows(rows, query({ filters: [entry] })).map((r) => r.id)).toEqual(
        expected,
      )
    }
  })

  it('ignores a filter on a column this surface does not render, rather than hiding every row', () => {
    const stale = filter({ key: 'somethingRemoved', operator: 'is', value: 'x' })
    expect(filterAbstractRows(rows, query({ filters: [stale] })).length).toBe(3)
  })
})

describe('sortAbstractRows', () => {
  const rows = [
    row({ id: 's1', rating: scored(84) }),
    row({ id: 's2', rating: { kind: 'none' } }),
    row({ id: 's3', rating: scored(91) }),
    row({ id: 's4', rating: { kind: 'not_required' } }),
  ]

  it('sorts unrated rows last in BOTH directions', () => {
    expect(sortAbstractRows(rows, { key: 'ratings', direction: 'desc' }).map((r) => r.id)).toEqual([
      's3',
      's1',
      's2',
      's4',
    ])
    expect(sortAbstractRows(rows, { key: 'ratings', direction: 'asc' }).map((r) => r.id)).toEqual([
      's1',
      's3',
      's2',
      's4',
    ])
  })

  it('does not mutate the input array, which is a cached read in every real caller', () => {
    const original = [...rows]
    sortAbstractRows(rows, { key: 'ratings', direction: 'desc' })
    expect(rows).toEqual(original)
  })

  it('returns the rows untouched when nothing is sorted', () => {
    expect(sortAbstractRows(rows, null)).toBe(rows)
  })

  it('treats an empty text cell as missing so it sorts last too', () => {
    expect(sortValue(row({ id: 'x', location: '' }), 'location')).toBeUndefined()
    expect(sortValue(row({ id: 'x', location: 'Hall A' }), 'location')).toBe('Hall A')
  })
})

describe('pageAbstractRows', () => {
  const rows = Array.from({ length: 7 }, (_, index) => row({ id: `s${index}` }))

  it('slices the requested page and reports the unsliced total', () => {
    const page = pageAbstractRows(rows, 2, 3)
    expect(page.rows.map((r) => r.id)).toEqual(['s3', 's4', 's5'])
    expect(page.totalRows).toBe(7)
    expect(page.page).toBe(2)
  })

  it('clamps a page number past the end, so a stale URL never shows an empty table', () => {
    expect(pageAbstractRows(rows, 99, 3).page).toBe(3)
    expect(pageAbstractRows(rows, 0, 3).page).toBe(1)
  })

  it('survives an empty result set', () => {
    expect(pageAbstractRows([], 1, 25)).toEqual({ rows: [], totalRows: 0, page: 1 })
  })
})

function query(patch: {
  tabId?: string
  search?: string
  filters?: readonly DataTableFilter[]
  trackId?: string
}) {
  return {
    tabId: patch.tabId ?? ALL_TAB_ID,
    search: patch.search ?? '',
    filters: patch.filters ?? [],
    sort: null,
    trackId: patch.trackId,
  }
}

function filter(patch: Omit<DataTableFilter, 'id'>): DataTableFilter {
  return { id: 'f0', ...patch }
}
