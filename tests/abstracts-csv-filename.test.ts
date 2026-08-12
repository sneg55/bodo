// The export filename is dated in the EVENT's zone, not in UTC.
//
// The case that produced the report: an export taken at 20:36 on August 9 in Los Angeles
// is already August 10 in UTC, so the file landed as `submissions-2026-08-10.csv` under a
// page header reading SUNDAY, AUGUST 9.

import { describe, expect, it } from 'vitest'

import { csvFilename } from '@/features/review/abstracts-csv'

describe('csvFilename', () => {
  it('dates the file in the event timezone, behind UTC', () => {
    expect(csvFilename('submissions', '2026-08-10T03:36:00.000Z', 'America/Los_Angeles')).toBe(
      'submissions-2026-08-09.csv',
    )
  })

  it('dates the file in the event timezone, ahead of UTC', () => {
    expect(csvFilename('abstracts', '2026-08-09T16:00:00.000Z', 'Asia/Tokyo')).toBe(
      'abstracts-2026-08-10.csv',
    )
  })

  it('dates the file in UTC when no zone is given', () => {
    expect(csvFilename('abstracts', '2026-08-10T03:36:00.000Z')).toBe('abstracts-2026-08-10.csv')
  })

  it('falls back to the instant rather than to today when the zone is unusable', () => {
    expect(csvFilename('sessions', '2026-08-10T03:36:00.000Z', 'Mars/Olympus')).toBe(
      'sessions-2026-08-10.csv',
    )
  })
})
