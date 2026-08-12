import { describe, expect, it } from 'vitest'

import { ErrorIds, isAppError } from '@/constants/errorIds'
import {
  checkRowCap,
  IMPORT_PAYLOAD_FIELD_KEYS,
  IMPORTABLE_FIELD_KEYS,
  parseImportPayload,
  summarize,
} from '@/features/crm/import/commit'
import { IMPORT_ROW_CAP } from '@/features/crm/import/fields'

describe('summarize', () => {
  it('counts each outcome kind', () => {
    const summary = summarize([
      { rowNumber: 2, status: 'created', speakerId: 'spk1' },
      { rowNumber: 3, status: 'updated', speakerId: 'spk2' },
      { rowNumber: 4, status: 'failed', email: 'bad@x.co', reason: 'Missing email' },
    ])
    expect(summary).toMatchObject({ created: 1, updated: 1, failed: 1 })
  })

  it('carries failures through for the downloadable report', () => {
    const summary = summarize([{ rowNumber: 9, status: 'failed', email: 'a@b.co', reason: 'Nope' }])
    expect(summary.failures).toEqual([{ rowNumber: 9, email: 'a@b.co', reason: 'Nope' }])
  })

  it('reports zeroes for an empty commit rather than throwing', () => {
    expect(summarize([])).toMatchObject({ created: 0, updated: 0, failed: 0 })
  })
})

describe('checkRowCap', () => {
  it('accepts a batch at exactly the cap', () => {
    expect(() => checkRowCap(IMPORT_ROW_CAP)).not.toThrow()
  })

  it('names the cap and the actual count when it refuses', () => {
    try {
      checkRowCap(IMPORT_ROW_CAP + 1)
      expect.unreachable('the cap should have been enforced')
    } catch (error) {
      expect(isAppError(error) && error.id).toBe(ErrorIds.CRM_ROW_CAP_EXCEEDED)
      expect(isAppError(error) && error.message).toContain(String(IMPORT_ROW_CAP))
      expect(isAppError(error) && error.message).toContain(String(IMPORT_ROW_CAP + 1))
    }
  })
})

// The action's argument is an open POST, so the wizard is one client and anything that can
// reach the endpoint is another. These assert the shape gate, not the content rules: an
// unmappable email is `planRow`'s answer to give, one row at a time, in the error report.
describe('parseImportPayload', () => {
  const valid = {
    submissionId: 'a1b2c3d4-0000-0000-0000-000000000000',
    eventId: 'recEvent1',
    rows: [{ rowNumber: 2, email: 'ada@example.com', firstName: 'Ada' }],
  }

  it('accepts what the wizard sends', () => {
    expect(parseImportPayload(valid).rows).toHaveLength(1)
  })

  it('drops a field the import may not write', () => {
    const parsed = parseImportPayload({
      ...valid,
      rows: [{ rowNumber: 2, email: 'ada@example.com', isAdmin: 'yes' }],
    })
    expect(parsed.rows[0]).not.toHaveProperty('isAdmin')
  })

  it('refuses a payload that is not the wizard’s shape', () => {
    expect(() => parseImportPayload({ ...valid, rows: [{ email: 'ada@example.com' }] })).toThrow()
    expect(() => parseImportPayload({ ...valid, eventId: '' })).toThrow()
    expect(() => parseImportPayload({ ...valid, submissionId: '' })).toThrow()
  })

  it('accepts exactly the fields the catalog offers, and no others', () => {
    expect([...IMPORT_PAYLOAD_FIELD_KEYS].sort()).toEqual([...IMPORTABLE_FIELD_KEYS].sort())
  })

  it('refuses more rows than the cap before any of them is read', () => {
    const rows = Array.from({ length: IMPORT_ROW_CAP + 1 }, (_, index) => ({
      rowNumber: index + 2,
      email: `speaker${index}@example.com`,
    }))
    expect(() => parseImportPayload({ ...valid, rows })).toThrow()
  })
})
