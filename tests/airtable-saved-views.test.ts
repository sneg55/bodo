// SavedViews, mapped from Airtable's own shape and built back into it.
//
// Written by hand in wire shape rather than round-tripped through the field builders, for
// the same reason tests/airtable-resources.test.ts is: a round trip agrees with itself even
// when both halves are wrong.
//
// The cases that matter are the three JSON columns, because each is a place where being
// wrong is invisible from the admin side. A blank blob has to read as "nothing stored" so a
// row created in Airtable directly still opens; a blob that does not match the schema has to
// FAIL loudly rather than silently hand back an empty column list that looks like a view
// which lost its columns; and an update has to send `[]` rather than omit the key, or an
// organizer who removes every filter and re-saves keeps the old filter.

import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import { mapSavedView } from '@/services/airtable/mapping-saved-views'
import type { AirtableRecord } from '@/services/airtable/records'
import {
  savedViewDefaultFields,
  savedViewFields,
  savedViewStateFields,
} from '@/services/airtable/to-fields-saved-views'

function record(id: string, fields: Record<string, unknown>): AirtableRecord {
  return { id, fields }
}

function errorId(fn: () => unknown): string {
  try {
    fn()
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.id : `not an AppError: ${String(error)}`
  }
}

const CORE = { name: 'Pending only', event: ['recEvent1'], surface: 'abstracts' }

describe('mapSavedView', () => {
  it('collapses the links and parses all three blobs', () => {
    const mapped = mapSavedView(
      record('recView1', {
        ...CORE,
        owner: ['recAdmin1'],
        columnsJson: '["status","title"]',
        sortJson: '{"key":"title","direction":"desc"}',
        filterJson: '[{"key":"status","operator":"is","value":"pending"}]',
        isDefault: true,
      }),
    )

    expect(mapped).toEqual({
      id: 'recView1',
      eventId: 'recEvent1',
      name: 'Pending only',
      surface: 'abstracts',
      ownerId: 'recAdmin1',
      columnKeys: ['status', 'title'],
      sort: { key: 'title', direction: 'desc' },
      filters: [{ id: 'v0', key: 'status', operator: 'is', value: 'pending' }],
      isDefault: true,
    })
  })

  it('reads a row seeded in Airtable with every optional column blank', () => {
    const mapped = mapSavedView(record('recView2', CORE))
    expect(mapped.ownerId).toBeUndefined()
    expect(mapped.columnKeys).toEqual([])
    expect(mapped.sort).toBeNull()
    expect(mapped.filters).toEqual([])
    // An unchecked Airtable checkbox is absent, not `false`.
    expect(mapped.isDefault).toBe(false)
  })

  it('numbers filter ids positionally, because the stored blob carries none', () => {
    const mapped = mapSavedView(
      record('recView3', {
        ...CORE,
        filterJson:
          '[{"key":"status","operator":"is","value":"pending"},{"key":"track","operator":"contains","value":"AI"}]',
      }),
    )
    expect(mapped.filters.map((filter) => filter.id)).toEqual(['v0', 'v1'])
  })

  it('refuses a surface outside the migration vocabulary rather than defaulting it', () => {
    // No fallback on purpose: the surface decides which dropdown the view appears in, so
    // reading an unknown one as `abstracts` puts an agenda view in the Abstracts menu.
    expect(errorId(() => mapSavedView(record('recView4', { ...CORE, surface: 'invoices' })))).toBe(
      ErrorIds.DATA_SHAPE_INVALID,
    )
  })

  it('refuses a blank name, which would be an unpickable entry in the dropdown', () => {
    expect(errorId(() => mapSavedView(record('recView5', { ...CORE, name: '' })))).toBe(
      ErrorIds.DATA_SHAPE_INVALID,
    )
  })

  it('refuses a filter blob with an operator the table does not have', () => {
    expect(
      errorId(() =>
        mapSavedView(
          record('recView6', { ...CORE, filterJson: '[{"key":"status","operator":"like"}]' }),
        ),
      ),
    ).toBe(ErrorIds.DATA_SHAPE_INVALID)
  })

  it('refuses a blob that is not JSON at all', () => {
    expect(
      errorId(() => mapSavedView(record('recView7', { ...CORE, columnsJson: '[status' }))),
    ).toBe(ErrorIds.DATA_SHAPE_INVALID)
  })
})

describe('savedViewFields', () => {
  it('writes the links as arrays and serializes the state', () => {
    expect(
      savedViewFields({
        eventId: 'recEvent1',
        name: 'Pending only',
        surface: 'abstracts',
        ownerId: 'recAdmin1',
        state: {
          columnKeys: ['status'],
          sort: { key: 'title', direction: 'asc' },
          filters: [{ id: 'v0', key: 'status', operator: 'is', value: 'pending' }],
        },
        isDefault: false,
      }),
    ).toEqual({
      name: 'Pending only',
      event: ['recEvent1'],
      surface: 'abstracts',
      owner: ['recAdmin1'],
      columnsJson: '["status"]',
      sortJson: '{"key":"title","direction":"asc"}',
      // The positional id is stripped: it means nothing outside one render pass.
      filterJson: '[{"key":"status","operator":"is","value":"pending"}]',
      isDefault: false,
    })
  })

  it('omits the owner link when there is no acting user, rather than clearing it', () => {
    const fields = savedViewFields({
      eventId: 'recEvent1',
      name: 'All',
      surface: 'sessions',
      state: { columnKeys: [], sort: null, filters: [] },
      isDefault: true,
    })
    expect(Object.hasOwn(fields, 'owner')).toBe(false)
    expect(fields.sortJson).toBe('null')
    expect(fields.isDefault).toBe(true)
  })
})

describe('savedViewStateFields', () => {
  it('always sends all three blobs, so emptying a view empties the stored one', () => {
    expect(savedViewStateFields({ columnKeys: [], sort: null, filters: [] })).toEqual({
      columnsJson: '[]',
      sortJson: 'null',
      filterJson: '[]',
    })
  })

  it('leaves the name alone unless one is passed, and never re-sends event or surface', () => {
    const fields = savedViewStateFields({ columnKeys: ['title'], sort: null, filters: [] })
    expect(Object.hasOwn(fields, 'name')).toBe(false)
    expect(Object.hasOwn(fields, 'event')).toBe(false)
    expect(Object.hasOwn(fields, 'surface')).toBe(false)
    expect(savedViewStateFields({ columnKeys: [], sort: null, filters: [] }, 'Renamed').name).toBe(
      'Renamed',
    )
  })
})

describe('savedViewDefaultFields', () => {
  it('touches the flag and nothing else, so marking a default cannot lose stored state', () => {
    expect(savedViewDefaultFields(true)).toEqual({ isDefault: true })
    expect(savedViewDefaultFields(false)).toEqual({ isDefault: false })
  })
})
