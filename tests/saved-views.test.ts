import { describe, expect, it } from 'vitest'

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import {
  applySavedView,
  checkSavedViewName,
  clearedDefaults,
  defaultSavedView,
  sameSavedViewState,
  sanitizeSavedViewState,
  savedViewDiff,
  sortSavedViews,
} from '@/features/views/saved-view-model'
import type { SavedView, SavedViewState } from '@/types/saved-views'

function view(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: 'recView1',
    eventId: 'recEvent',
    name: 'Pending only',
    surface: 'abstracts',
    columnKeys: ['status', 'title'],
    sort: { key: 'title', direction: 'asc' },
    filters: [{ id: 'v0', key: 'status', operator: 'is', value: 'pending' }],
    isDefault: false,
    ...overrides,
  }
}

const state: SavedViewState = {
  columnKeys: ['status', 'title'],
  sort: { key: 'title', direction: 'asc' },
  filters: [{ id: 'f0', key: 'status', operator: 'is', value: 'pending' }],
}

describe('sameSavedViewState', () => {
  it('ignores the filter id, which is positional and never persisted', () => {
    expect(sameSavedViewState(view(), state)).toBe(true)
  })

  it('treats column order as part of the state, because the drawer reorders columns', () => {
    expect(sameSavedViewState(view(), { ...state, columnKeys: ['title', 'status'] })).toBe(false)
  })

  it('separates a missing sort from a sort in the other direction', () => {
    expect(sameSavedViewState(view(), { ...state, sort: null })).toBe(false)
    expect(
      sameSavedViewState(view(), { ...state, sort: { key: 'title', direction: 'desc' } }),
    ).toBe(false)
  })

  it('compares filter operator and value, not just the key', () => {
    const other: DataTableFilter = { id: 'f0', key: 'status', operator: 'is_not', value: 'pending' }
    expect(sameSavedViewState(view(), { ...state, filters: [other] })).toBe(false)
  })

  it('is order sensitive on filters, so two filters swapped is a change', () => {
    const first: DataTableFilter = { id: 'f0', key: 'status', operator: 'is', value: 'pending' }
    const second: DataTableFilter = { id: 'f1', key: 'track', operator: 'is', value: 'recA' }
    const saved = view({ filters: [first, second] })
    expect(sameSavedViewState(saved, { ...state, filters: [second, first] })).toBe(false)
    expect(sameSavedViewState(saved, { ...state, filters: [first, second] })).toBe(true)
  })
})

describe('savedViewDiff', () => {
  it('is empty when the table already shows the view', () => {
    expect(savedViewDiff(view(), state)).toEqual([])
  })

  it('names only the parts that differ', () => {
    expect(savedViewDiff(view(), { ...state, sort: null })).toEqual(['sort'])
    expect(savedViewDiff(view(), { columnKeys: [], sort: null, filters: [] })).toEqual([
      'columns',
      'sort',
      'filter',
    ])
  })
})

describe('applySavedView', () => {
  it('renumbers filter ids positionally, so the drawer gets stable keys', () => {
    const applied = applySavedView(
      view({
        filters: [
          { id: 'stored-a', key: 'status', operator: 'is', value: 'pending' },
          { id: 'stored-a', key: 'track', operator: 'contains', value: 'AI' },
        ],
      }),
    )
    expect(applied.filters.map((filter) => filter.id)).toEqual(['v0', 'v1'])
  })

  it('hands back a copy, so applying a view cannot mutate the stored one', () => {
    const saved = view()
    const applied = applySavedView(saved)
    expect(applied.columnKeys).toEqual(saved.columnKeys)
    expect(applied.columnKeys).not.toBe(saved.columnKeys)
  })
})

describe('defaultSavedView', () => {
  it('is undefined when nothing is flagged', () => {
    expect(defaultSavedView([view(), view({ id: 'recView2' })])).toBeUndefined()
  })

  it('picks the flagged view', () => {
    const flagged = view({ id: 'recView2', name: 'Accept queue', isDefault: true })
    expect(defaultSavedView([view(), flagged])?.id).toBe('recView2')
  })

  it('resolves two flagged rows deterministically, since Airtable has no constraint', () => {
    const b = view({ id: 'recB', name: 'Beta', isDefault: true })
    const a = view({ id: 'recA', name: 'alpha', isDefault: true })
    expect(defaultSavedView([b, a])?.id).toBe('recA')
    expect(defaultSavedView([a, b])?.id).toBe('recA')
  })
})

describe('sortSavedViews', () => {
  it('orders by name, case insensitively, without mutating the input', () => {
    const input = [view({ id: '1', name: 'zeta' }), view({ id: '2', name: 'Alpha' })]
    expect(sortSavedViews(input).map((entry) => entry.name)).toEqual(['Alpha', 'zeta'])
    expect(input.map((entry) => entry.name)).toEqual(['zeta', 'Alpha'])
  })
})

describe('checkSavedViewName', () => {
  it('accepts a trimmed, unused name', () => {
    expect(checkSavedViewName(' Accept queue ', [view()])).toBeUndefined()
  })

  it('refuses an empty name', () => {
    expect(checkSavedViewName('   ', [])).toBe('Enter a name for this view.')
  })

  it('refuses a name over 255 characters', () => {
    expect(checkSavedViewName('x'.repeat(256), [])).toBe('That name is too long.')
  })

  it('refuses a duplicate, ignoring case and surrounding space', () => {
    expect(checkSavedViewName('pending ONLY', [view()])).toBe('A view called that already exists.')
  })

  it('lets a view keep its own name when it is being renamed', () => {
    expect(checkSavedViewName('Pending only', [view()], 'recView1')).toBeUndefined()
  })
})

describe('clearedDefaults', () => {
  it('lists the other flagged views, which are the rows a write has to clear', () => {
    const views = [
      view({ id: 'recA', isDefault: true }),
      view({ id: 'recB', isDefault: true }),
      view({ id: 'recC', isDefault: false }),
    ]
    expect(clearedDefaults(views, 'recB')).toEqual(['recA'])
  })

  it('clears every flag when no view is becoming the default', () => {
    const views = [view({ id: 'recA', isDefault: true }), view({ id: 'recB', isDefault: true })]
    expect(clearedDefaults(views, undefined)).toEqual(['recA', 'recB'])
  })
})

describe('sanitizeSavedViewState', () => {
  it('leaves a legitimate state alone apart from renumbering filter ids', () => {
    expect(sanitizeSavedViewState(state)).toEqual({
      columnKeys: ['status', 'title'],
      sort: { key: 'title', direction: 'asc' },
      filters: [{ id: 'v0', key: 'status', operator: 'is', value: 'pending' }],
    })
  })

  it('drops blank and duplicated column keys, keeping the first position', () => {
    const sanitized = sanitizeSavedViewState({
      ...state,
      columnKeys: ['title', '', 'status', 'title'],
    })
    expect(sanitized.columnKeys).toEqual(['title', 'status'])
  })

  it('caps the stored column and filter counts', () => {
    const many = Array.from({ length: 200 }, (_, index) => `col${index}`)
    const filters = Array.from({ length: 200 }, (_, index) => ({
      id: `f${index}`,
      key: `k${index}`,
      operator: 'is' as const,
      value: 'x',
    }))
    const sanitized = sanitizeSavedViewState({ columnKeys: many, sort: null, filters })
    expect(sanitized.columnKeys).toHaveLength(100)
    expect(sanitized.filters).toHaveLength(50)
  })

  it('drops a filter whose operator is not one the table knows', () => {
    const sanitized = sanitizeSavedViewState({
      ...state,
      filters: [
        { id: 'f0', key: 'status', operator: 'DROP TABLE' as never, value: 'x' },
        { id: 'f1', key: 'track', operator: 'contains', value: 'AI' },
      ],
    })
    expect(sanitized.filters).toEqual([
      { id: 'v0', key: 'track', operator: 'contains', value: 'AI' },
    ])
  })

  it('drops a sort with no key and normalises an unknown direction to ascending', () => {
    expect(
      sanitizeSavedViewState({ ...state, sort: { key: '', direction: 'asc' } }).sort,
    ).toBeNull()
    expect(
      sanitizeSavedViewState({ ...state, sort: { key: 'title', direction: 'sideways' as never } })
        .sort,
    ).toEqual({ key: 'title', direction: 'asc' })
  })
})
