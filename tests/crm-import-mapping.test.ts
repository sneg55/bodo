import { describe, expect, it } from 'vitest'
import { SPEAKER_CRM_FIELDS } from '@/constants/speaker-crm-fields'
import { parseCsv } from '@/features/crm/import/csv-parse'
import { IMPORT_ROW_CAP, IMPORTABLE_FIELDS } from '@/features/crm/import/fields'
import { autoMapHeaders, mapRow, missingRequiredFields } from '@/features/crm/import/map-row'

describe('autoMapHeaders', () => {
  it('matches a header regardless of case, spaces and punctuation', () => {
    const mapping = autoMapHeaders(['E-Mail Address', 'First Name', 'Last name'])
    expect(mapping.get('E-Mail Address')).toBe('email')
    expect(mapping.get('First Name')).toBe('firstName')
    expect(mapping.get('Last name')).toBe('lastName')
  })

  it('leaves an unrecognised header unmapped rather than guessing', () => {
    expect(autoMapHeaders(['Favourite Colour']).has('Favourite Colour')).toBe(false)
  })

  it('maps a duplicated header only once, keeping the first', () => {
    const mapping = autoMapHeaders(['Email', 'email'])
    expect([...mapping.values()].filter((v) => v === 'email')).toHaveLength(1)
    expect(mapping.get('Email')).toBe('email')
    expect(mapping.has('email')).toBe(false)
  })

  it('maps two different spellings of one field only once, keeping the first', () => {
    const mapping = autoMapHeaders(['Email Address', 'E-mail'])
    expect(mapping.get('Email Address')).toBe('email')
    expect(mapping.has('E-mail')).toBe(false)
  })

  it('survives the same header string appearing twice', () => {
    expect([...autoMapHeaders(['Email', 'Email'])]).toEqual([['Email', 'email']])
  })

  it('ignores a UTF-8 BOM stuck to the first header', () => {
    expect(autoMapHeaders(['﻿Email']).get('﻿Email')).toBe('email')
  })

  it('ignores an empty or whitespace-only header', () => {
    expect(autoMapHeaders(['', '   ']).size).toBe(0)
  })

  it('maps nothing when the file has no headers at all', () => {
    expect(autoMapHeaders([]).size).toBe(0)
  })

  it('maps every importable field from its most obvious spelling', () => {
    const mapping = autoMapHeaders([
      'Email',
      'First Name',
      'Last Name',
      'Company',
      'Tagline',
      'Phone',
      'Bio',
    ])
    expect([...mapping.values()]).toEqual([
      'email',
      'firstName',
      'lastName',
      'company',
      'tagline',
      'phone',
      'bio',
    ])
  })

  it('maps a file whose first row is data rather than headers to nothing', () => {
    // A header-less file parses with its first DATA row as headers. Nothing there looks like
    // a field name, so the mapper offers no guesses and the required-field gate stops the
    // import rather than writing a person named "ada@example.com".
    const parsed = parseCsv('ada@example.com,Ada,Lovelace\nbob@example.com,Bob,Bell')
    const mapping = autoMapHeaders(parsed.headers)
    expect(mapping.size).toBe(0)
    expect(missingRequiredFields(mapping).map((f) => f.key)).toEqual(['email'])
  })
})

describe('missingRequiredFields', () => {
  it('is empty once a header maps to email', () => {
    expect(missingRequiredFields(autoMapHeaders(['Email', 'Company']))).toEqual([])
  })

  it('names email when only optional columns mapped', () => {
    expect(missingRequiredFields(autoMapHeaders(['Company'])).map((f) => f.label)).toEqual([
      'Email',
    ])
  })
})

describe('mapRow', () => {
  const mapping = new Map([
    ['Email', 'email' as const],
    ['First Name', 'firstName' as const],
  ])

  it('rejects a row with no email, since email is the identity', () => {
    expect(mapRow({ Email: '', 'First Name': 'Ada' }, mapping, 2)).toEqual({
      ok: false,
      reason: 'Missing email',
    })
  })

  it('rejects an email with no @', () => {
    expect(mapRow({ Email: 'nope', 'First Name': 'Ada' }, mapping, 2).ok).toBe(false)
  })

  it('carries the 1-based row number through for the error report', () => {
    const result = mapRow({ Email: 'a@b.co', 'First Name': 'Ada' }, mapping, 7)
    expect(result.ok && result.row.rowNumber).toBe(7)
  })

  it('rejects a row whose email column is missing entirely', () => {
    expect(mapRow({ 'First Name': 'Ada' }, mapping, 3)).toEqual({
      ok: false,
      reason: 'Missing email',
    })
  })

  it('gives the same reasons the write layer gives, so one error report reads consistently', () => {
    expect(mapRow({ Email: '   ' }, mapping, 2)).toEqual({ ok: false, reason: 'Missing email' })
    expect(mapRow({ Email: 'nope' }, mapping, 2)).toEqual({ ok: false, reason: 'Invalid email' })
  })

  it('trims cells but keeps the email as typed, since the write layer normalizes', () => {
    const result = mapRow({ Email: '  Ada@Example.COM  ', 'First Name': ' Ada ' }, mapping, 2)
    expect(result.ok && result.row).toEqual({
      rowNumber: 2,
      email: 'Ada@Example.COM',
      firstName: 'Ada',
    })
  })

  it('omits an empty cell rather than carrying a blank, which would erase existing data', () => {
    const result = mapRow({ Email: 'a@b.co', 'First Name': '  ' }, mapping, 2)
    expect(result.ok && Object.hasOwn(result.row, 'firstName')).toBe(false)
  })

  it('ignores a column the mapping does not name', () => {
    const result = mapRow({ Email: 'a@b.co', Notes: 'ignore me' }, mapping, 2)
    expect(result.ok && result.row).toEqual({ rowNumber: 2, email: 'a@b.co' })
  })

  const twoEmails = new Map([
    ['Email', 'email' as const],
    ['Contact Email', 'email' as const],
  ])

  it('takes the first mapped header when two headers claim one field', () => {
    const result = mapRow({ Email: 'a@b.co', 'Contact Email': 'z@z.co' }, twoEmails, 2)
    expect(result.ok && result.row.email).toBe('a@b.co')
  })

  it('falls through to the second header when the first is blank', () => {
    // First NON-EMPTY wins, not first. An export with an empty Email column beside a filled
    // Contact Email is a real shape, and rejecting it as "Missing email" with the address one
    // column over would be indefensible.
    const result = mapRow({ Email: '   ', 'Contact Email': 'z@z.co' }, twoEmails, 2)
    expect(result.ok && result.row.email).toBe('z@z.co')
  })

  it('reads a short row, where the file gave fewer cells than headers', () => {
    const parsed = parseCsv('Email,First Name\na@b.co')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row).toEqual({ rowNumber: 2, email: 'a@b.co' })
  })

  it('reads a long row, where the file gave more cells than headers', () => {
    const parsed = parseCsv('Email\na@b.co,extra,cells')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row).toEqual({ rowNumber: 2, email: 'a@b.co' })
  })

  it('maps a BOM-prefixed header through parseCsv end to end', () => {
    const parsed = parseCsv('﻿Email,First Name\nada@example.com,Ada')
    const result = mapRow(parsed.rows[0], autoMapHeaders(parsed.headers), 2)
    expect(result.ok && result.row).toEqual({
      rowNumber: 2,
      email: 'ada@example.com',
      firstName: 'Ada',
    })
  })

  it('produces no rows at all from an empty file', () => {
    const parsed = parseCsv('')
    expect(parsed.rows).toEqual([])
    expect(autoMapHeaders(parsed.headers).size).toBe(0)
  })
})

describe('IMPORTABLE_FIELDS', () => {
  it('requires email and nothing else', () => {
    expect(IMPORTABLE_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(['email'])
  })

  it('labels every field exactly as the directory column of the same key does', () => {
    const catalog = new Map(SPEAKER_CRM_FIELDS.map((f) => [f.key, f.label]))
    for (const field of IMPORTABLE_FIELDS) {
      expect(catalog.get(field.key)).toBe(field.label)
    }
  })

  it('caps one import at a round, conservative number of rows', () => {
    expect(IMPORT_ROW_CAP).toBe(500)
  })
})
