// The SUBMISSIONS catalog and its renderers have to agree, and nothing at runtime says so.
//
// What went wrong without this: `submitter` and `speakers` were rendered as columns and
// labelled with `DataTableColumn.label`, but they were in no catalog. The Columns picker is
// built from `catalog.fields`, so neither appeared in the left-hand Fields list and removing
// one was permanent, and the Selected pane falls back to the raw key, so the chips read
// `submitter` and `speakers` in lower case beside a column of Title Case labels.
//
// The same shape as tests/crm-speaker-columns.test.ts, because it is the same invariant on
// the other surface built over this primitive.

import { describe, expect, it } from 'vitest'
import {
  ABSTRACTS_CATALOG,
  abstractColumns,
  EXTRA_DEFAULT_COLUMN_KEYS,
} from '@/app/(admin)/admin/[eventId]/(organizer)/abstracts/abstracts-cells'
import { SESSION_CATALOG } from '@/components/primitives/data-table-types'
import { DEFAULT_COLUMN_KEYS } from '@/constants/fields'
import { SORTABLE_ROW_KEYS } from '@/features/review/abstracts-accessors'

const columnKeys = abstractColumns({
  ratingsLabel: 'Ratings: Screening',
  canEditStatus: true,
  eventId: 'rec1',
  onStatusChange: () => undefined,
}).map((column) => column.key)

const catalogKeys = ABSTRACTS_CATALOG.fields.map((field) => field.key)

describe('the submissions column catalog', () => {
  it('offers every column it renders, so a removed one can be added back', () => {
    // Ratings included: it carries a `DataTableColumn.label` because the header is named
    // after the event's evaluation plan, but the catalog still has to hold the key or the
    // picker cannot offer it and the Selected chip falls back to `ratings`.
    expect(columnKeys.filter((key) => !catalogKeys.includes(key))).toEqual([])
  })

  it('renders every field it offers, so no checkbox in the picker does nothing', () => {
    expect(catalogKeys.filter((key) => !columnKeys.includes(key))).toEqual([])
  })

  it('names the two participant columns rather than leaving the raw key to show', () => {
    const labels = new Map(ABSTRACTS_CATALOG.fields.map((field) => [field.key, field.label]))
    expect(labels.get('submitter')).toBe('Session Submitter')
    expect(labels.get('speakers')).toBe('Speaker')
  })

  it('gives every field the help text the header tooltip needs', () => {
    expect(
      ABSTRACTS_CATALOG.fields
        .filter((field) => field.help === undefined)
        .map((field) => field.key),
    ).toEqual([])
  })

  it('carries no duplicate key', () => {
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length)
  })

  it('resets to the set the table opens with, participant columns included', () => {
    expect(ABSTRACTS_CATALOG.defaultColumnKeys).toEqual([
      ...DEFAULT_COLUMN_KEYS,
      ...EXTRA_DEFAULT_COLUMN_KEYS,
    ])
  })
})

describe('the two participant columns', () => {
  it('can be sorted and filtered, so the panes do not offer a dead control', () => {
    // The Sort and Filter panes offer `catalog.fields` narrowed to `sortableKeys`, and
    // `SORTABLE_ROW_KEYS` is derived from the accessors, so both keys answer.
    expect(SORTABLE_ROW_KEYS.has('submitter')).toBe(true)
    expect(SORTABLE_ROW_KEYS.has('speakers')).toBe(true)
  })

  it('stays out of the shared catalog every other table defaults to', () => {
    // Files, Agenda List, the sync log and the portal content lists have no accessor for
    // either key, so adding them to SESSION_CATALOG would put two unrenderable fields in
    // their Columns pickers.
    const shared = SESSION_CATALOG.fields.map((field) => field.key)
    expect(shared).not.toContain('submitter')
    expect(shared).not.toContain('speakers')
  })
})
