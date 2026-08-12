// A filter on a multi-valued column compares against each value, not the joined cell.
//
// The defect these pin was found in the eval run of 2026-08-10 and confirmed by running the
// real accessors: the CRM's Speaker Tags accessor joins a person's tags to `AI, Infra` for
// the cell, and `matchesOneFilter` compared that whole string, so `Speaker Tags is AI` was
// FALSE for the one speaker who actually carried the AI tag. An organizer got back a set
// that did not match the criteria they had stated, in either direction.

import { describe, expect, it } from 'vitest'

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import { matchesFilters, type RowAccessors } from '@/features/views/table-query'

type Row = { name: string; tags: readonly string[] }

const ACCESSORS: RowAccessors<Row> = {
  text: (row, key) =>
    key === 'name' ? row.name : key === 'tags' ? row.tags.join(', ') : undefined,
  numeric: () => false,
  number: () => undefined,
  searchableKeys: ['name'],
  list: (row, key) => (key === 'tags' ? row.tags : undefined),
}

function filter(over: Partial<DataTableFilter>): DataTableFilter {
  return { id: 'f0', key: 'tags', operator: 'is', value: 'AI', ...over }
}

const multi: Row = { name: 'Priya Raman', tags: ['AI', 'Infra'] }
const single: Row = { name: 'Ada Okafor', tags: ['AI'] }
const other: Row = { name: 'Marcus Webb', tags: ['Infra'] }
const none: Row = { name: 'Sam Whitfield', tags: [] }

describe('is, on a multi-valued column', () => {
  it('matches a row that carries the value alongside others', () => {
    expect(matchesFilters(multi, [filter({})], ACCESSORS)).toBe(true)
  })

  it('still matches a row carrying only that value', () => {
    expect(matchesFilters(single, [filter({})], ACCESSORS)).toBe(true)
  })

  it('does not match a row carrying a different value', () => {
    expect(matchesFilters(other, [filter({})], ACCESSORS)).toBe(false)
  })

  it('does not match an empty cell', () => {
    expect(matchesFilters(none, [filter({})], ACCESSORS)).toBe(false)
  })

  it('is case insensitive, as every other operator here is', () => {
    expect(matchesFilters(multi, [filter({ value: 'ai' })], ACCESSORS)).toBe(true)
  })
})

describe('is_not, on a multi-valued column', () => {
  it('excludes a row that carries the value alongside others', () => {
    // The honest negation of the case above. Comparing the joined cell made this TRUE for
    // somebody tagged AI and Infra, so "is not AI" returned people who are tagged AI.
    expect(matchesFilters(multi, [filter({ operator: 'is_not' })], ACCESSORS)).toBe(false)
  })

  it('keeps a row that carries none of it', () => {
    expect(matchesFilters(other, [filter({ operator: 'is_not' })], ACCESSORS)).toBe(true)
  })
})

describe('the other operators', () => {
  it('contains matches inside any one value', () => {
    expect(matchesFilters(multi, [filter({ operator: 'contains', value: 'nfr' })], ACCESSORS)).toBe(
      true,
    )
  })

  it('is_empty is true only with no values at all', () => {
    expect(matchesFilters(none, [filter({ operator: 'is_empty' })], ACCESSORS)).toBe(true)
    expect(matchesFilters(single, [filter({ operator: 'is_empty' })], ACCESSORS)).toBe(false)
  })

  it('is_not_empty is its complement', () => {
    expect(matchesFilters(none, [filter({ operator: 'is_not_empty' })], ACCESSORS)).toBe(false)
    expect(matchesFilters(single, [filter({ operator: 'is_not_empty' })], ACCESSORS)).toBe(true)
  })
})

describe('single-valued columns are unchanged', () => {
  it('compares the whole cell, so a name is not matched word by word', () => {
    const named = filter({ key: 'name', value: 'Priya' })
    expect(matchesFilters(multi, [named], ACCESSORS)).toBe(false)
    expect(matchesFilters(multi, [filter({ key: 'name', value: 'Priya Raman' })], ACCESSORS)).toBe(
      true,
    )
  })

  it('still ignores a key this surface cannot read, rather than hiding every row', () => {
    expect(matchesFilters(multi, [filter({ key: 'nothing-here' })], ACCESSORS)).toBe(true)
  })
})

describe('every criterion is applied, not just the first', () => {
  it('narrows on the second criterion too', () => {
    // The reported symptom: a first criterion narrowed the directory, and adding a second
    // returned the same rows. Both have to bind.
    const both = [filter({ id: 'f0', key: 'name', value: 'Priya Raman' }), filter({ id: 'f1' })]

    expect(matchesFilters(multi, both, ACCESSORS)).toBe(true)
    expect(matchesFilters({ name: 'Priya Raman', tags: ['Infra'] }, both, ACCESSORS)).toBe(false)
  })
})
