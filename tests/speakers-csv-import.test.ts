// The speaker CSV import.
//
// The parser tests are the ones that matter. A bulk import exists to take a file exported
// from a system nobody here has seen, so the cases worth pinning are the ones a naive
// `split(',')` corrupts silently: a quoted surname containing a comma, a doubled quote, and
// a bio with a newline in it. Each of those produces a plausible-looking wrong record rather
// than an error, which is the worst failure mode an import can have.

import { describe, expect, it } from 'vitest'

import { parseCsv, planSpeakerImport } from '@/features/speakers/csv-import'

describe('parseCsv', () => {
  it('splits a plain file', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps a comma inside quotes, which is the case split(",") destroys', () => {
    expect(parseCsv('name,email\n"Okafor, Ada",ada@example.com')).toEqual([
      ['name', 'email'],
      ['Okafor, Ada', 'ada@example.com'],
    ])
  })

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsv('tagline\n"She said ""hello"""')).toEqual([['tagline'], ['She said "hello"']])
  })

  it('keeps a newline inside quotes in the same cell', () => {
    expect(parseCsv('bio\n"Line one\nLine two"')).toEqual([['bio'], ['Line one\nLine two']])
  })

  it('normalises CRLF, because a file saved on Windows is the common case', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('ignores a trailing blank line rather than reading it as a row', () => {
    expect(parseCsv('a\n1\n')).toEqual([['a'], ['1']])
  })
})

describe('planSpeakerImport', () => {
  it('maps the header row onto fields', () => {
    const plan = planSpeakerImport(
      'First Name,Last Name,Email,Company\nAda,Okafor,ADA@example.com,Bodo Labs',
    )

    expect(plan.problems).toEqual([])
    expect(plan.rows).toEqual([
      { email: 'ada@example.com', firstName: 'Ada', lastName: 'Okafor', company: 'Bodo Labs' },
    ])
  })

  it('accepts the header spellings real exports use', () => {
    // Making somebody rename columns to match our internals is how an import gets abandoned.
    const plan = planSpeakerImport('given_name,surname,Email Address\nAda,Okafor,ada@example.com')

    expect(plan.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'Okafor' })
  })

  it('ignores a column it has no field for, rather than refusing the file', () => {
    const plan = planSpeakerImport('Email,Attendee ID\nada@example.com,A-1234')

    expect(plan.rows).toEqual([{ email: 'ada@example.com' }])
    // Ignored, but SAID. Silence here is how a header this app does not recognise turns
    // into an import that reports success and quietly drops a name.
    expect(plan.problems).toEqual([
      { line: 1, message: 'not imported, no matching field: Attendee ID' },
    ])
  })

  it('reads a single Name column, which is what most exports actually have', () => {
    const plan = planSpeakerImport('Name,Email\nDana Kowalski,dana@example.com')

    expect(plan.problems).toEqual([])
    expect(plan.rows[0]).toMatchObject({ firstName: 'Dana', lastName: 'Kowalski' })
  })

  it('keeps an explicit First/Last pair over a Name column that also exists', () => {
    // A file carrying both is telling us where the boundary is. Guessing over the top of
    // that would be worse than not guessing at all.
    const plan = planSpeakerImport(
      'Name,First Name,Last Name,Email\nWrong Person,Ada,Okafor,ada@example.com',
    )

    expect(plan.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'Okafor' })
  })

  it('splits a surname-first name on the comma', () => {
    const plan = planSpeakerImport('Email,Name\nada@example.com,"Okafor, Ada"')

    expect(plan.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'Okafor' })
  })

  it('keeps a middle name with the first, and leaves a single word as a first name', () => {
    const plan = planSpeakerImport(
      'Email,Name\na@example.com,Ada Nkemdirim Okafor\nb@example.com,Prince',
    )

    expect(plan.rows[0]).toMatchObject({ firstName: 'Ada Nkemdirim', lastName: 'Okafor' })
    expect(plan.rows[1]).toMatchObject({ firstName: 'Prince' })
    expect(plan.rows[1]?.lastName).toBeUndefined()
  })

  it('refuses a file with no email column, and says which column is missing', () => {
    const plan = planSpeakerImport('Name,Company\nAda,Bodo Labs')

    expect(plan.rows).toEqual([])
    expect(plan.problems[0].message).toContain('email column')
  })

  it('reports a bad row with its spreadsheet line number and keeps the good ones', () => {
    const plan = planSpeakerImport(
      'Email,First Name\nada@example.com,Ada\nnot-an-email,Bruno\nchen@example.com,Chen',
    )

    expect(plan.rows.map((row) => row.email)).toEqual(['ada@example.com', 'chen@example.com'])
    // Line 3: the header is 1, so the second data row is 3, which is what a spreadsheet shows.
    expect(plan.problems).toEqual([{ line: 3, message: '"not-an-email" is not an email address' }])
  })

  it('reports a row with no email at all', () => {
    const plan = planSpeakerImport('Email,First Name\n,Ada')

    expect(plan.rows).toEqual([])
    expect(plan.problems[0].message).toBe('no email address')
  })

  it('takes the first of a repeated address and reports the rest', () => {
    // Two writes racing to upsert one record would let the second overwrite the first.
    const plan = planSpeakerImport(
      'Email,Company\nada@example.com,Bodo Labs\nADA@example.com,Somewhere Else',
    )

    expect(plan.rows).toEqual([{ email: 'ada@example.com', company: 'Bodo Labs' }])
    expect(plan.problems[0].message).toContain('more than once')
  })

  it('accepts a known status and lowercases it', () => {
    const plan = planSpeakerImport('Email,Status\nada@example.com,Confirmed')

    expect(plan.rows[0].status).toBe('confirmed')
    expect(plan.problems).toEqual([])
  })

  it('keeps the person when the status is one we do not know, and says so', () => {
    const plan = planSpeakerImport('Email,Status\nada@example.com,VIP')

    expect(plan.rows).toEqual([{ email: 'ada@example.com' }])
    expect(plan.problems[0].message).toContain('imported as prospect')
  })

  it('reports an empty file rather than importing nothing quietly', () => {
    expect(planSpeakerImport('').problems[0].message).toBe('that file is empty')
  })
})
