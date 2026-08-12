// The paging contract for `/api/v1`. Every case here is one a client discovers by writing a
// loop against it, and none of them throw, so a test is the only thing that catches them.

import { describe, expect, it } from 'vitest'

import { DEFAULT_SIZE, MAX_SIZE, paginate } from '@/features/api/pagination'

const rows = Array.from({ length: 250 }, (_, index) => index)

describe('paginate', () => {
  it('defaults to page 1 at the documented size', () => {
    const page = paginate(rows, {})

    expect(page.page).toBe(1)
    expect(page.size).toBe(DEFAULT_SIZE)
    expect(page.data).toHaveLength(DEFAULT_SIZE)
    expect(page.data.at(0)).toBe(0)
  })

  it('reports the collection total rather than the page length', () => {
    // The one a client uses to decide how many pages there are, so returning 25 here would
    // make every paging loop stop after the first page.
    expect(paginate(rows, {}).total).toBe(250)
  })

  it('is 1-based', () => {
    expect(paginate(rows, { page: '2', size: '10' }).data.at(0)).toBe(10)
  })

  it('clamps size to the maximum instead of refusing', () => {
    const page = paginate(rows, { size: '1000' })

    expect(page.size).toBe(MAX_SIZE)
    expect(page.data).toHaveLength(MAX_SIZE)
  })

  it('clamps a zero or negative size to one', () => {
    // Zero is the dangerous one: an unclamped size of 0 slices nothing on every page, so a
    // loop that walks until it gets an empty page never terminates.
    expect(paginate(rows, { size: '0' }).size).toBe(1)
    expect(paginate(rows, { size: '-5' }).size).toBe(1)
  })

  it('clamps a zero or negative page to the first', () => {
    // Negative offsets slice from the END of the array, so `page=-1` would quietly serve
    // the last rows of the collection as though they were the first.
    expect(paginate(rows, { page: '0' }).data.at(0)).toBe(0)
    expect(paginate(rows, { page: '-3' }).data.at(0)).toBe(0)
  })

  it('treats absent, empty and unparseable values as the default', () => {
    for (const size of [null, undefined, '', '   ', 'abc', 'NaN']) {
      expect(paginate(rows, { size }).size).toBe(DEFAULT_SIZE)
    }
  })

  it('returns an empty page past the end rather than failing', () => {
    const page = paginate(rows, { page: '99', size: '25' })

    expect(page.data).toHaveLength(0)
    expect(page.total).toBe(250)
  })

  it('truncates a fractional page or size', () => {
    expect(paginate(rows, { size: '10.9' }).size).toBe(10)
  })
})
