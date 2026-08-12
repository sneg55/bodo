import { describe, expect, it } from 'vitest'

import {
  abstractsToCsv,
  csvCell,
  csvFilename,
  csvHeaderFor,
  toCsv,
} from '@/features/review/abstracts-csv'
import type { AbstractRow } from '@/features/review/abstracts-rows'

function row(overrides: Partial<AbstractRow> & { id: string }): AbstractRow {
  return {
    code: 'SESS-1',
    title: 'A talk',
    status: 'pending',
    reviewRequired: true,
    sourceLabel: 'Session Submission Form',
    description: '',
    dates: { notifiedAt: '', submittedAt: '', startsAt: '', endsAt: '' },
    scheduleStatus: 'unscheduled',
    tags: [],
    speakers: [],
    chairpersons: [],
    submitterEmail: '',
    rating: { kind: 'none' },
    ...overrides,
  }
}

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Evaluating agents')).toBe('Evaluating agents')
  })

  it('quotes and doubles quotes when the value contains a comma or a quote', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
  })

  it('neutralises a leading character a spreadsheet would evaluate as a formula', () => {
    // Not CSV pedantry: Excel and Sheets evaluate a cell starting = + - or @, so a title
    // like "-2 hours of your life" becomes an error cell, and worse is possible.
    for (const dangerous of ['=SUM(A1)', '+1', '-2 hours', '@here']) {
      const cell = csvCell(dangerous)
      expect(cell.startsWith('"\t') || cell.startsWith('\t')).toBe(true)
    }
  })
})

describe('toCsv', () => {
  it('joins rows with CRLF, which is what RFC 4180 and Excel expect', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a,b\r\nc,d')
  })
})

describe('csvHeaderFor', () => {
  it('names the Ratings column after the evaluation plan', () => {
    expect(csvHeaderFor('ratings', 'Ratings: 2026 Program Review')).toBe(
      'Ratings: 2026 Program Review',
    )
  })

  it('uses the registry label for a registry column', () => {
    expect(csvHeaderFor('title', 'Ratings')).toBe('Title')
    expect(csvHeaderFor('notifiedAt', 'Ratings')).toBe('Notified')
  })

  it('names the two participant columns the registry has no entry for', () => {
    expect(csvHeaderFor('submitter', 'Ratings')).toBe('Session Submitter')
    expect(csvHeaderFor('speakers', 'Ratings')).toBe('Speaker')
  })

  it('has no header for a key it cannot name', () => {
    expect(csvHeaderFor('somethingRemoved', 'Ratings')).toBeUndefined()
  })
})

describe('abstractsToCsv', () => {
  it('exports exactly the visible columns, in their chosen order', () => {
    const csv = abstractsToCsv(
      [row({ id: 's1', title: 'Evaluating agents', code: 'SESS-9' })],
      ['title', 'code'],
      'Ratings',
    )
    expect(csv).toBe('Title,ID\r\nEvaluating agents,SESS-9')
  })

  it('drops a stored column key the table can no longer render', () => {
    const csv = abstractsToCsv([row({ id: 's1' })], ['title', 'somethingRemoved'], 'Ratings')
    expect(csv.split('\r\n')[0]).toBe('Title')
  })

  it('writes the rating placeholder rather than a zero', () => {
    const csv = abstractsToCsv(
      [row({ id: 's1', rating: { kind: 'not_required' } })],
      ['ratings'],
      'Ratings',
    )
    expect(csv.split('\r\n')[1]).not.toBe('0')
  })

  it('emits a header row even with no data', () => {
    expect(abstractsToCsv([], ['title'], 'Ratings')).toBe('Title')
  })
})

describe('csvFilename', () => {
  it('dates the file so two exports do not overwrite each other', () => {
    expect(csvFilename('abstracts', '2026-08-08T10:00:00.000Z')).toBe('abstracts-2026-08-08.csv')
  })
})
