import { describe, expect, it } from 'vitest'
import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  DUPLICATE_OF_ROW_PREFIX,
  dedupeRows,
  findDuplicates,
  normalizeEmail,
} from '@/features/crm/import/dedup'
import type { AirtableClient } from '@/services/airtable/client'
import { loadSpeakersByEmail, planRow } from '@/services/airtable/mutations-crm-import-plan'
import type { AirtableRecord } from '@/services/airtable/records'
import { COL } from '@/services/airtable/tables'
import { dedupedBatch } from './helpers/deduped-batch'

/** `loadSpeakersByEmail` calls exactly one method, so the whole client is that method. */
function clientListing(records: readonly AirtableRecord[]): AirtableClient {
  return { listAll: () => Promise.resolve(records) } as unknown as AirtableClient
}

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })
})

// The rule this module and the write layer must never disagree on. Asserting normalizeEmail
// against a string literal only restates its body; these run the same awkward pair through
// BOTH implementations and assert they land on one key. This is the test that fails if
// somebody changes either side.
describe('normalizeEmail agrees with the write layer', () => {
  const awkward = '  ADA@Example.COM '
  const plain = 'ada@example.com'

  it('keys loadSpeakersByEmail on exactly what normalizeEmail produces', async () => {
    const byEmail = await loadSpeakersByEmail(
      clientListing([{ id: 'recSpk1', fields: { [COL.email]: awkward } }]),
    )
    expect(byEmail.get(normalizeEmail(plain))?.id).toBe('recSpk1')
    expect([...byEmail.keys()]).toEqual([normalizeEmail(awkward)])
  })

  it('resolves a row planRow matches to the same key findDuplicates would', async () => {
    const byEmail = await loadSpeakersByEmail(
      clientListing([{ id: 'recSpk1', fields: { [COL.email]: awkward } }]),
    )
    const row = { rowNumber: 2, email: plain }
    const plan = planRow(0, row, 'recEvt1', byEmail)

    expect(plan.kind).toBe('update')
    expect(plan.kind === 'update' && plan.recordId).toBe('recSpk1')
    // Same pair, same verdict, from this module's side.
    expect(findDuplicates([row], [{ id: 'recSpk1', email: awkward }]).get(2)).toBe('recSpk1')
  })

  it('names the same record the write layer would when two speakers share an email', async () => {
    // Airtable enforces no uniqueness on email, so this is a real state, and preview and
    // commit must land on one record or the preview names spk1 while the commit updates spk2.
    const records = [
      { id: 'recSpk1', fields: { [COL.email]: 'a@b.co' } },
      { id: 'recSpk2', fields: { [COL.email]: 'A@B.CO' } },
    ]
    const byEmail = await loadSpeakersByEmail(clientListing(records))
    const dupes = findDuplicates(
      [{ rowNumber: 2, email: 'a@b.co' }],
      records.map((r) => ({ id: r.id, email: String(r.fields[COL.email]) })),
    )

    expect(byEmail.get('a@b.co')?.id).toBe('recSpk2')
    expect(dupes.get(2)).toBe('recSpk2')
  })

  it('agrees whichever ORDER the colliding pair arrives in', async () => {
    // The hazard a shared tie-break removes. `existing` is whatever array a caller passes:
    // the directory's row model is sorted by family name and `listAll` is not sorted at all,
    // so a rule about position ("last one read wins") makes the answer depend on the caller.
    // Every one of these four holds the same two records and must name the same one.
    const records = [
      { id: 'recSpk1', fields: { [COL.email]: 'a@b.co' } },
      { id: 'recSpk2', fields: { [COL.email]: 'A@B.CO' } },
    ]
    const reversed = [...records].reverse()
    const asExisting = (rs: typeof records) =>
      rs.map((r) => ({ id: r.id, email: String(r.fields[COL.email]) }))
    const row = [{ rowNumber: 2, email: 'a@b.co' }]

    expect([
      (await loadSpeakersByEmail(clientListing(records))).get('a@b.co')?.id,
      (await loadSpeakersByEmail(clientListing(reversed))).get('a@b.co')?.id,
      findDuplicates(row, asExisting(records)).get(2),
      findDuplicates(row, asExisting(reversed)).get(2),
    ]).toEqual(['recSpk2', 'recSpk2', 'recSpk2', 'recSpk2'])
  })
})

describe('findDuplicates', () => {
  it('flags a row matching an existing speaker by normalized email', () => {
    const existing = [{ id: 'spk1', email: 'ADA@example.com' }]
    const dupes = findDuplicates([{ rowNumber: 2, email: 'ada@example.com' }], existing)
    expect(dupes.get(2)).toBe('spk1')
  })

  it('flags a duplicate appearing twice within the file itself', () => {
    const dupes = findDuplicates(
      [
        { rowNumber: 2, email: 'a@b.co' },
        { rowNumber: 3, email: 'A@B.CO' },
      ],
      [],
    )
    expect(dupes.has(3)).toBe(true)
  })

  it('treats surrounding whitespace and case as one person, exactly as the write layer does', () => {
    const dupes = findDuplicates(
      [
        { rowNumber: 2, email: 'ada@example.com' },
        { rowNumber: 3, email: ' ADA@EXAMPLE.COM ' },
      ],
      [],
    )
    expect(dupes.get(3)).toBe(`${DUPLICATE_OF_ROW_PREFIX}2`)
    expect(dupes.has(2)).toBe(false)
  })

  it('points every later repeat at the first row, not at the one above it', () => {
    const dupes = findDuplicates(
      [
        { rowNumber: 2, email: 'a@b.co' },
        { rowNumber: 3, email: 'a@b.co' },
        { rowNumber: 4, email: 'a@b.co' },
      ],
      [],
    )
    expect([...dupes]).toEqual([
      [3, `${DUPLICATE_OF_ROW_PREFIX}2`],
      [4, `${DUPLICATE_OF_ROW_PREFIX}2`],
    ])
  })

  it('reports an in-file repeat as such even when the email also exists already', () => {
    const dupes = findDuplicates(
      [
        { rowNumber: 2, email: 'a@b.co' },
        { rowNumber: 3, email: 'a@b.co' },
      ],
      [{ id: 'spk1', email: 'a@b.co' }],
    )
    expect(dupes.get(2)).toBe('spk1')
    expect(dupes.get(3)).toBe(`${DUPLICATE_OF_ROW_PREFIX}2`)
  })

  it('flags nothing for an empty file or an empty directory', () => {
    expect(findDuplicates([], []).size).toBe(0)
    expect(findDuplicates([{ rowNumber: 2, email: 'a@b.co' }], []).size).toBe(0)
  })

  it('ignores rows with no email rather than pairing two of them off', () => {
    const dupes = findDuplicates(
      [
        { rowNumber: 2, email: '' },
        { rowNumber: 3, email: '  ' },
      ],
      [],
    )
    expect(dupes.size).toBe(0)
  })

  it('ignores an existing speaker with no email', () => {
    expect(findDuplicates([{ rowNumber: 2, email: '' }], [{ id: 'spk1', email: '' }]).size).toBe(0)
  })

  it('prefers the greatest record id of two speakers sharing an email, not the last one given', () => {
    // The ids are ordered against the array on purpose: `spk9` is FIRST in position and
    // greatest by id, so a positional rule ("last wins", which this module briefly had) and
    // the actual rule (`winsEmailTie`) give different answers here. With the ids the other
    // way round the two agree and the test proves nothing.
    const dupes = findDuplicates(
      [{ rowNumber: 2, email: 'a@b.co' }],
      [
        { id: 'spk9', email: 'a@b.co' },
        { id: 'spk1', email: 'A@B.CO' },
      ],
    )
    expect(dupes.get(2)).toBe('spk9')
  })
})

describe('dedupeRows', () => {
  it('keeps the first row of a repeated email and reports the dropped row numbers', () => {
    const result = dedupeRows([
      { rowNumber: 2, email: 'a@b.co', firstName: 'Ada' },
      { rowNumber: 3, email: ' A@B.CO ', firstName: 'Adah' },
      { rowNumber: 4, email: 'bob@b.co' },
    ])
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 4])
    expect(result.rows[0].firstName).toBe('Ada')
    expect(result.dropped).toEqual([3])
  })

  it('drops every later repeat of a three-way collision', () => {
    const result = dedupeRows([
      { rowNumber: 2, email: 'a@b.co' },
      { rowNumber: 3, email: 'a@b.co' },
      { rowNumber: 4, email: 'A@B.co' },
    ])
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2])
    expect(result.dropped).toEqual([3, 4])
  })

  it('leaves a file with no repeats untouched', () => {
    const rows = [
      { rowNumber: 2, email: 'a@b.co' },
      { rowNumber: 3, email: 'b@b.co' },
    ]
    const result = dedupeRows(rows)
    expect(result.rows).toEqual(rows)
    expect(result.dropped).toEqual([])
  })

  it('keeps rows with no email, leaving the write layer to report them one by one', () => {
    const result = dedupeRows([
      { rowNumber: 2, email: '' },
      { rowNumber: 3, email: '' },
    ])
    expect(result.rows).toHaveLength(2)
    expect(result.dropped).toEqual([])
  })

  it('returns nothing for an empty batch rather than throwing', () => {
    expect(dedupeRows([])).toEqual({ rows: [], dropped: [] })
  })

  it('loses the fields of the row it drops, which is why dropped is reported', () => {
    // The recorded tradeoff, pinned so it cannot change by accident: row 3's bio does not
    // survive onto row 2. Merging was rejected; the summary names row 3 instead.
    const result = dedupeRows([
      { rowNumber: 2, email: 'a@b.co', firstName: 'Ada' },
      { rowNumber: 3, email: 'a@b.co', bio: 'Wrote the first algorithm' },
    ])
    expect(result.rows).toEqual([{ rowNumber: 2, email: 'a@b.co', firstName: 'Ada' }])
    expect(result.dropped).toEqual([3])
  })
})

// The brand's only other door, and it lives in tests/ precisely so the import wizard cannot
// reach for it: it throws where an uploaded file needs `dedupeRows` to drop and report.
describe('dedupedBatch (test helper)', () => {
  it('passes a batch with no repeats through unchanged', () => {
    const rows = [
      { rowNumber: 2, email: 'a@b.co' },
      { rowNumber: 3, email: 'b@b.co' },
    ]
    expect(dedupedBatch(rows)).toEqual(rows)
  })

  it('throws on a repeat rather than laundering it past the brand, naming the rows', () => {
    expect(() =>
      dedupedBatch([
        { rowNumber: 2, email: 'a@b.co' },
        { rowNumber: 3, email: ' A@B.CO ' },
      ]),
    ).toThrow(/row\(s\) 3/)
  })

  it('carries the error id, so the caller bug is greppable', () => {
    try {
      dedupedBatch([
        { rowNumber: 2, email: 'a@b.co' },
        { rowNumber: 3, email: 'a@b.co' },
      ])
      expect.unreachable('dedupedBatch accepted a repeated email')
    } catch (error) {
      expect(isAppError(error) && error.id).toBe(ErrorIds.CRM_BATCH_NOT_DEDUPED)
    }
  })
})
