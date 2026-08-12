// The combined `Name` mapping target: how a single name column is split, and that a file
// carrying one imports without the organizer choosing anything.
//
// Separate from `crm-import-mapping.test.ts` because it is one rule with a lot of edges
// (mononyms, middle names, an explicit column beside the combined one) rather than another
// case of the header matcher, and because the gap it closes was a scored one: before this
// target existed, a fixture whose only name column was `name` could be pointed at nothing but
// `Ignore this column`, so the import landed addresses and no names at all.

import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/features/crm/import/csv-parse'
import {
  COMBINED_NAME_TARGET,
  IMPORTABLE_FIELDS,
  MAPPING_TARGETS,
} from '@/features/crm/import/fields'
import { autoMapHeaders, mapRow, splitFullName } from '@/features/crm/import/map-row'
import {
  COLUMN_CHOICES,
  choicesFromMapping,
  dispositions,
  importRowName,
  mappingFromChoices,
  mapRows,
} from '@/features/crm/import/wizard-state'

describe('splitFullName', () => {
  it('takes the last token as the last name and the rest as the first', () => {
    expect(splitFullName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })

  it('keeps a middle name with the first name, since there is no column for it', () => {
    expect(splitFullName('Ada Byron King Lovelace')).toEqual({
      firstName: 'Ada Byron King',
      lastName: 'Lovelace',
    })
  })

  it('files a single token as a FIRST name, not a surname', () => {
    // A mononym is a person's name and the directory sorts on lastName, so putting it there
    // would sort them away from the row the organizer typed.
    expect(splitFullName('Prince')).toEqual({ firstName: 'Prince' })
  })

  it('answers with neither half for an empty or whitespace-only cell', () => {
    expect(splitFullName('')).toEqual({})
    expect(splitFullName('   ')).toEqual({})
  })

  it('trims the cell and collapses internal whitespace', () => {
    expect(splitFullName('  Ada   Lovelace  ')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('splits on a tab or a newline, not only on a space', () => {
    expect(splitFullName('Ada\tLovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })

  it('does not reverse a comma-separated name, which would be a guess', () => {
    // Deliberate: `Lovelace, Ada` keeps the comma rather than being silently reversed. The
    // mapping step's own First Name / Last Name targets are the correction for such a file.
    expect(splitFullName('Lovelace, Ada')).toEqual({ firstName: 'Lovelace,', lastName: 'Ada' })
  })
})

describe('the Name mapping target', () => {
  it('is offered between Email and First Name', () => {
    expect(MAPPING_TARGETS.map((target) => target.key)).toEqual([
      'email',
      COMBINED_NAME_TARGET,
      'firstName',
      'lastName',
      'company',
      'tagline',
      'phone',
      'bio',
    ])
  })

  it('is labelled Name and is not required', () => {
    const target = MAPPING_TARGETS.find((entry) => entry.key === COMBINED_NAME_TARGET)
    expect(target?.label).toBe('Name')
    expect(target?.required).toBe(false)
  })

  it('is a mapping target only, and is never a stored field', () => {
    // The payload schema and the write layer still see exactly the seven writable columns.
    expect(IMPORTABLE_FIELDS.map((field) => field.key)).not.toContain(COMBINED_NAME_TARGET)
  })

  it('appears in the mapping step Select beside Ignore this column', () => {
    expect(COLUMN_CHOICES.map((choice) => choice.label)).toEqual([
      'Ignore this column',
      'Email (required)',
      'Name',
      'First Name',
      'Last Name',
      'Company',
      'Tagline',
      'Mobile Phone',
      'Biography',
    ])
  })
})

describe('a CSV with one name column', () => {
  const csv = 'name,email\nAda Lovelace,ada@example.com\nPrince,prince@example.com\n'

  it('auto-maps the name column without the organizer choosing anything', () => {
    const parsed = parseCsv(csv)
    const mapping = autoMapHeaders(parsed.headers)
    expect(mapping.get('name')).toBe(COMBINED_NAME_TARGET)
    expect(mapping.get('email')).toBe('email')
  })

  it('imports the name data as firstName and lastName', () => {
    const parsed = parseCsv(csv)
    const mapping = autoMapHeaders(parsed.headers)
    expect(mapRow(parsed.rows[0], mapping, 2)).toEqual({
      ok: true,
      row: { rowNumber: 2, email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
    })
    expect(mapRow(parsed.rows[1], mapping, 3)).toEqual({
      ok: true,
      row: { rowNumber: 3, email: 'prince@example.com', firstName: 'Prince' },
    })
  })

  it('survives the wizard round trip from auto-map to the mapping mapRow takes', () => {
    const parsed = parseCsv(csv)
    const choices = choicesFromMapping(parsed.headers, autoMapHeaders(parsed.headers))
    expect(choices.get('name')).toBe(COMBINED_NAME_TARGET)
    expect(mappingFromChoices(choices).get('name')).toBe(COMBINED_NAME_TARGET)
  })

  it.each(['Full Name', 'Speaker Name', 'Contact name', 'DISPLAY NAME'])(
    'recognises %s as the combined name column',
    (header) => {
      expect(autoMapHeaders([header]).get(header)).toBe(COMBINED_NAME_TARGET)
    },
  )

  it('does not mistake Company Name for the combined name column', () => {
    expect(autoMapHeaders(['Company Name']).get('Company Name')).toBe('company')
  })

  it('writes nothing under the target key itself', () => {
    const parsed = parseCsv(csv)
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && Object.hasOwn(result.row, COMBINED_NAME_TARGET)).toBe(false)
  })

  it('omits both halves when the name cell is blank, rather than erasing existing data', () => {
    const parsed = parseCsv('name,email\n   ,ada@example.com\n')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row).toEqual({ rowNumber: 2, email: 'ada@example.com' })
  })
})

describe('the preview', () => {
  it('shows the split name for every row of a single-name-column file', () => {
    const parsed = parseCsv('name,email\nAda Lovelace,ada@example.com\nPrince,prince@example.com\n')
    const mapped = mapRows(parsed.rows, autoMapHeaders(parsed.headers))
    expect(dispositions(mapped.rows, new Map()).map((row) => row.name)).toEqual([
      'Ada Lovelace',
      'Prince',
    ])
  })

  it('carries no name key at all when the file mapped none', () => {
    const parsed = parseCsv('email\nada@example.com\n')
    const mapped = mapRows(parsed.rows, autoMapHeaders(parsed.headers))
    expect(dispositions(mapped.rows, new Map())).toEqual([
      { rowNumber: 2, email: 'ada@example.com', kind: 'create' },
    ])
  })

  it('joins only the halves that are present, with no stray space', () => {
    expect(importRowName({ rowNumber: 2, email: 'a@b.co' })).toBeUndefined()
    expect(importRowName({ rowNumber: 2, email: 'a@b.co', firstName: 'Ada' })).toBe('Ada')
    expect(importRowName({ rowNumber: 2, email: 'a@b.co', lastName: 'Lovelace' })).toBe('Lovelace')
  })
})

describe('a CSV with both a combined and a specific name column', () => {
  it('lets an explicit Last Name column win over the split half', () => {
    const parsed = parseCsv('Name,Last Name,Email\nAda Lovelace,King,ada@example.com\n')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row).toEqual({
      rowNumber: 2,
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'King',
    })
  })

  it('wins the same way whichever column the export put first', () => {
    const parsed = parseCsv('Last Name,Name,Email\nKing,Ada Lovelace,ada@example.com\n')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row.lastName).toBe('King')
  })

  it('keeps the split half when the specific column is empty on this row', () => {
    const parsed = parseCsv('Name,Last Name,Email\nAda Lovelace,,ada@example.com\n')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row.lastName).toBe('Lovelace')
  })
})
