// What the two Accelevents controls report back.
//
// The actions themselves are `'use server'` and reach Airtable, a Durable Object and a
// remote API, so what is worth pinning is the part a wrong answer misleads an organizer
// with: the counts in the toast. These are the numbers somebody decides on. "Sync
// complete" over three refused sessions is exactly the behaviour BUILD_SPEC 5.0d objects
// to in the vendor's own product, where a failure is routed to support rather than
// surfaced.
//
// The distinction the assertions exist for is FAILED versus BLOCKED. A failure reached
// Accelevents and was refused, so it is in the sync log and `Retry failed` will pick it
// up. A blocked entity was never sent and could not even be logged (an unparseable payload
// would abort every later retry, so `sync-walk.ts` refuses to write one), which means
// nothing will ever retry it and the fix is upstream in bodo's own data. Reported as one
// number, an organizer presses `Retry failed` on rows no retry can see.

import { describe, expect, it } from 'vitest'

import { summarizeRetry, summarizeSync, totalCounts } from '@/features/integrations/run-summary'
import type { AcceleventsSyncResult } from '@/features/jobs/accelevents-sync'
import type { EntityCounts, ForwardSyncResult } from '@/services/accelevents/sync'

const NONE: EntityCounts = { created: 0, updated: 0, skipped: 0, failed: 0, contended: 0 }

const forward = (
  counts: Partial<Record<keyof ForwardSyncResult['counts'], Partial<EntityCounts>>> = {},
  blocked = 0,
): ForwardSyncResult => ({
  eventId: 'recEvent1',
  counts: {
    speaker: { ...NONE, ...counts.speaker },
    submission: { ...NONE, ...counts.submission },
    track: { ...NONE, ...counts.track },
    tag: { ...NONE, ...counts.tag },
  },
  blocked,
})

const retry = (overrides: Partial<AcceleventsSyncResult> = {}): AcceleventsSyncResult => ({
  found: 0,
  retried: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  contended: 0,
  ...overrides,
})

describe('totalCounts', () => {
  it('adds every entity type together, since the toast is a total and the log is the detail', () => {
    expect(
      totalCounts(
        forward({
          speaker: { created: 2, failed: 1 },
          submission: { created: 3, updated: 1, skipped: 4, contended: 2 },
          track: { updated: 5 },
        }),
      ),
    ).toEqual({ created: 5, updated: 6, skipped: 4, failed: 1, contended: 2 })
  })
})

describe('summarizeSync', () => {
  it('leads with what landed and calls a clean run a success', () => {
    const summary = summarizeSync(forward({ submission: { created: 4, skipped: 1 } }))
    expect(summary.message).toBe('Sync now: 4 created, 0 updated, 1 unchanged.')
    expect(summary.needsAttention).toBe(false)
  })

  it('never hides a failure, and stops calling the run a success', () => {
    const summary = summarizeSync(forward({ speaker: { created: 1, failed: 2 } }))
    expect(summary.message).toContain('2 failed')
    expect(summary.needsAttention).toBe(true)
  })

  it('reports blocked entities separately from failed ones', () => {
    const summary = summarizeSync(forward({ submission: { created: 1 } }, 3))
    expect(summary.message).toContain('3 could not be sent')
    expect(summary.message).not.toContain('failed')
    expect(summary.needsAttention).toBe(true)
  })

  it('mentions contention without treating it as a problem to chase', () => {
    const summary = summarizeSync(forward({ speaker: { updated: 1, contended: 1 } }))
    expect(summary.message).toContain('1 already in flight')
    expect(summary.needsAttention).toBe(false)
  })

  it('leaves out the counts that are zero, so the sentence stays readable', () => {
    expect(summarizeSync(forward()).message).toBe('Sync now: 0 created, 0 updated, 0 unchanged.')
  })
})

describe('summarizeRetry', () => {
  it('says nothing was waiting rather than reporting a row of zeroes', () => {
    // "nothing to retry" and "retried nothing" read the same in a count and mean opposite
    // things to somebody who has just watched a sync fail.
    expect(summarizeRetry(retry())).toEqual({
      message: 'Retry failed: nothing is waiting to be retried.',
      needsAttention: false,
    })
  })

  it('counts what it found as well as what it did', () => {
    const summary = summarizeRetry(retry({ found: 3, retried: 3, succeeded: 2, failed: 1 }))
    expect(summary.message).toBe(
      'Retry failed: 3 rows found, 2 succeeded, 0 already up to date, 1 failed again.',
    )
    expect(summary.needsAttention).toBe(true)
  })

  it('agrees with itself about one row', () => {
    expect(summarizeRetry(retry({ found: 1, succeeded: 1 })).message).toContain('1 row found')
  })

  it('treats a contended row as somebody else"s work in progress, not a failure', () => {
    const summary = summarizeRetry(retry({ found: 2, succeeded: 1, contended: 1 }))
    expect(summary.message).toContain('1 held by another run')
    expect(summary.needsAttention).toBe(false)
  })

  it('does not call a skip a failure: a matching hash means the payload was already accepted', () => {
    const summary = summarizeRetry(retry({ found: 2, skipped: 2 }))
    expect(summary.message).toContain('2 already up to date')
    expect(summary.needsAttention).toBe(false)
  })
})
