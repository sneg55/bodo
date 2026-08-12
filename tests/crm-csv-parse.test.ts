import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/features/crm/import/csv-parse'
import { escapeCsv, neutralizeFormula } from '@/features/crm/import/csv-safe'
import { buildErrorCsv, type ErrorReportRow } from '@/features/crm/import/error-report'
import { sampleValues } from '@/features/crm/import/sample-values'

describe('parseCsv', () => {
  it('reads headers and header-keyed rows', () => {
    const parsed = parseCsv('email,first\na@b.co,Ada')
    expect(parsed.headers).toEqual(['email', 'first'])
    expect(parsed.rows).toEqual([{ email: 'a@b.co', first: 'Ada' }])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('a,b\n"x,y",z').rows[0]).toEqual({ a: 'x,y', b: 'z' })
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"say ""hi"""').rows[0]).toEqual({ a: 'say "hi"' })
  })

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",z').rows[0]).toEqual({ a: 'line1\nline2', b: 'z' })
  })

  it('accepts CRLF endings', () => {
    expect(parseCsv('a,b\r\n1,2').rows[0]).toEqual({ a: '1', b: '2' })
  })

  it('returns no rows for an empty document', () => {
    expect(parseCsv('').rows).toEqual([])
  })
})

describe('parseCsv edge-case headers', () => {
  it('stores a __proto__ header as an ordinary own property rather than the prototype accessor', () => {
    const row = parseCsv('__proto__,name\nx,Ada').rows[0]
    expect(Object.hasOwn(row, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
    expect(row['__proto__']).toBe('x')
    expect(() => row['__proto__'].trim()).not.toThrow()
  })

  it('stores a constructor header as an ordinary own property, same as the source implementation', () => {
    const row = parseCsv('constructor,name\nWidget,Ada').rows[0]
    expect(Object.hasOwn(row, 'constructor')).toBe(true)
    expect(row['constructor']).toBe('Widget')
  })
})

describe('escapeCsv', () => {
  it('quotes a value containing a comma', () => {
    expect(escapeCsv('x,y')).toBe('"x,y"')
  })

  it('doubles an embedded quote', () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes a value containing a bare carriage return', () => {
    expect(escapeCsv('line1\rline2')).toBe('"line1\rline2"')
  })

  it('prefixes a formula-leading value with an apostrophe so it renders as literal text', () => {
    expect(escapeCsv('=1+1')).toBe("'=1+1")
  })

  it('leaves a plain value untouched', () => {
    expect(escapeCsv('Ada Lovelace')).toBe('Ada Lovelace')
  })
})

describe('neutralizeFormula', () => {
  it('prefixes values starting with =, +, -, @, tab, or CR', () => {
    expect(neutralizeFormula('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(neutralizeFormula('+1')).toBe("'+1")
    expect(neutralizeFormula('-1')).toBe("'-1")
    expect(neutralizeFormula('@mention')).toBe("'@mention")
  })

  it('leaves a value that does not start with a formula lead untouched', () => {
    expect(neutralizeFormula('Ada Lovelace')).toBe('Ada Lovelace')
  })
})

describe('sampleValues', () => {
  const rows = [{ city: 'Berlin' }, { city: '' }, { city: 'Lisbon' }, { city: 'Prague' }]

  it('skips blank cells and stops at the limit', () => {
    expect(sampleValues(rows, 'city')).toEqual(['Berlin', 'Lisbon'])
  })

  it('respects an explicit limit', () => {
    expect(sampleValues(rows, 'city', 1)).toEqual(['Berlin'])
  })
})

describe('buildErrorCsv', () => {
  it('echoes a raw column through to the report so a failed row is recoverable', () => {
    const failures: ErrorReportRow[] = [
      {
        rowNumber: 2,
        raw: { email: 'not-an-email', first: 'Ada' },
        errors: [{ field: 'email', message: 'must be a valid email' }],
      },
    ]
    const csv = buildErrorCsv(failures)
    const [head, ...lines] = csv.split('\n')
    expect(head).toBe('row,errors,email,first')
    expect(lines[0]).toBe('2,email: must be a valid email,not-an-email,Ada')
  })

  it('unions raw headers across rows in first-seen order and backfills missing columns', () => {
    const failures: ErrorReportRow[] = [
      { rowNumber: 2, raw: { email: 'a@b.co' }, errors: [] },
      { rowNumber: 3, raw: { email: 'c@d.co', company: 'Acme' }, errors: [] },
    ]
    const csv = buildErrorCsv(failures)
    const [head, first, second] = csv.split('\n')
    expect(head).toBe('row,errors,email,company')
    expect(first).toBe('2,,a@b.co,')
    expect(second).toBe('3,,c@d.co,Acme')
  })

  it('round-trips a raw value containing a bare carriage return without splitting the row', () => {
    const failures: ErrorReportRow[] = [
      { rowNumber: 2, raw: { notes: 'line1\rline2' }, errors: [] },
    ]
    const csv = buildErrorCsv(failures)
    const reparsed = parseCsv(csv)
    expect(reparsed.rows).toHaveLength(1)
    expect(reparsed.rows[0]).toEqual({ row: '2', errors: '', notes: 'line1\rline2' })
  })
})
