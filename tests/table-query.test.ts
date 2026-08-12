import { describe, expect, it } from 'vitest'

import {
  matchesFilters,
  matchesSearch,
  pageRows,
  type RowAccessors,
  sortRows,
} from '@/features/views/table-query'

type Row = { name: string; score?: number }

const accessors: RowAccessors<Row> = {
  text: (row, key) =>
    key === 'name' ? row.name : key === 'score' ? row.score?.toString() : undefined,
  numeric: (key) => key === 'score',
  number: (row, key) => (key === 'score' ? row.score : undefined),
  searchableKeys: ['name'],
}

const rows: Row[] = [{ name: 'Ada', score: 3 }, { name: 'Grace' }, { name: 'Alan', score: 1 }]

describe('table-query', () => {
  it('ignores a filter on a key the surface does not render', () => {
    // A stored view outlives a column set, so an unresolvable key must not hide every row.
    expect(
      matchesFilters(rows[0], [{ id: 'f1', key: 'nope', operator: 'is', value: 'x' }], accessors),
    ).toBe(true)
  })

  it('matches contains case-insensitively', () => {
    expect(
      matchesFilters(
        rows[0],
        [{ id: 'f1', key: 'name', operator: 'contains', value: 'AD' }],
        accessors,
      ),
    ).toBe(true)
  })

  it('treats an empty search as matching everything', () => {
    expect(matchesSearch(rows[1], '   ', accessors)).toBe(true)
  })

  it('sorts missing values last in both directions', () => {
    const desc = sortRows(rows, { key: 'score', direction: 'desc' }, accessors)
    const asc = sortRows(rows, { key: 'score', direction: 'asc' }, accessors)
    expect(desc.at(-1)?.name).toBe('Grace')
    expect(asc.at(-1)?.name).toBe('Grace')
  })

  it('does not mutate the input array', () => {
    const original = [...rows]
    sortRows(rows, { key: 'name', direction: 'asc' }, accessors)
    expect(rows).toEqual(original)
  })

  it('clamps a page number past the end', () => {
    expect(pageRows(rows, 99, 2).page).toBe(2)
  })
})
