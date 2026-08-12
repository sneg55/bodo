// The directory's catalog and its renderers have to agree, and nothing at runtime says so.
//
// `DataTable` drops a visible column key it has no renderer for, and the Columns picker
// offers every key in the catalog. So a catalog entry with no cell is a checkbox that does
// nothing when ticked, and a column with no catalog entry is a header with no label and no
// tooltip, which the parity audit requires on every one. Both fail silently in a browser,
// so they are pinned here.

import { describe, expect, it } from 'vitest'

import {
  SPEAKER_CRM_CATALOG,
  SPEAKER_CRM_DEFAULT_COLUMN_KEYS,
  SPEAKER_CRM_FIELDS,
} from '@/constants/speaker-crm-fields'
import { speakerColumns } from '@/features/crm/speaker-columns'
import { SPEAKER_ACCESSORS } from '@/features/crm/speaker-rows'

const columnKeys = speakerColumns().map((column) => column.key)
const catalogKeys = SPEAKER_CRM_FIELDS.map((field) => field.key)

describe('the speaker CRM column catalog', () => {
  it('renders every field it offers', () => {
    expect(catalogKeys.filter((key) => !columnKeys.includes(key))).toEqual([])
  })

  it('offers every column it renders', () => {
    expect(columnKeys.filter((key) => !catalogKeys.includes(key))).toEqual([])
  })

  it('gives every field the help text the header tooltip needs', () => {
    expect(SPEAKER_CRM_FIELDS.filter((field) => field.help === undefined)).toEqual([])
  })

  it('opens on the columns an organizer needs to recognize and segment a person', () => {
    expect(SPEAKER_CRM_DEFAULT_COLUMN_KEYS).toEqual([
      'name',
      'email',
      'company',
      'tagline',
      'tags',
      'eventCount',
      'sessionCount',
    ])
  })

  it('can sort and filter on everything it offers except the headshot', () => {
    const queryable = SPEAKER_CRM_CATALOG.queryableFields.map((field) => field.key)
    expect(catalogKeys.filter((key) => !queryable.includes(key))).toEqual(['headshot'])
  })

  it('has an accessor behind every queryable field, so no condition silently passes', () => {
    // `matchesFilters` keeps a row when the accessor returns undefined, which is right for
    // a stored view naming a column this surface dropped and wrong for a field the drawer
    // is still offering: that filter would match everything.
    const row = {
      speaker: { id: 'spk1', email: 'a@example.com', firstName: 'A', lastName: 'B', links: {} },
      eventCount: 0,
      sessionCount: 0,
      tags: [],
    }
    const unbacked = SPEAKER_CRM_CATALOG.queryableFields
      .map((field) => field.key)
      .filter((key) => SPEAKER_ACCESSORS.text(row, key) === undefined)
    expect(unbacked).toEqual([])
  })
})
