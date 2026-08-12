// Which outbox rows the sender is allowed to attempt.
//
// `failed` used to be excluded here, which quietly disabled the entire retry design:
// `markOutboxFailed` documents that "`failed` is retried once the lease lapses, `dead`
// never is", and `drain.ts` sets MAX_ATTEMPTS = 5 to choose between them, but a row that
// left the due list after one failure could only ever reach attempts = 1. Every
// transient provider failure lost its mail permanently, and nothing surfaced it, because
// the row still sat in Airtable looking like a record of something that had been tried.
//
// `sending` is here for the mirror-image reason. The drain now records a claim on the row
// before it calls the provider, so a sender that dies mid-flight leaves the row at that
// status; excluding it by status would strand exactly that row, never sendable and never
// `dead`. Only the lease holds a `sending` row back, and only while it has not lapsed.
//
// These tests exist so neither of those can silently come back.

import { describe, expect, it } from 'vitest'

import type { OutboxStatus } from '@/constants/status'
import { dueOutboxRows } from '@/services/airtable/reads-portal'
import type { OutboxRow } from '@/types/domain'

const NOW = '2026-08-08T12:00:00.000Z'
const EARLIER = '2026-08-08T11:00:00.000Z'
const LATER = '2026-08-08T13:00:00.000Z'

function row(over: Partial<OutboxRow> & { id: string }): OutboxRow {
  return {
    eventId: 'recEvt1',
    templateSource: 'system',
    idempotencyKey: `key-${over.id}`,
    toEmail: 'ada@example.com',
    sendAt: EARLIER,
    status: 'queued',
    attempts: 0,
    payload: { subject: 'Reminder', html: '<p>hi</p>', attachIcs: false },
    ...over,
  }
}

function ids(rows: readonly OutboxRow[]): readonly string[] {
  return rows.map((each) => each.id)
}

describe('which statuses are due', () => {
  it('includes a failed row, which is what makes a retry possible at all', () => {
    const rows = [row({ id: 'rec1', status: 'failed', attempts: 1 })]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['rec1'])
  })

  it('still includes a queued row', () => {
    expect(ids(dueOutboxRows([row({ id: 'rec1' })], 'recEvt1', NOW, 10))).toEqual(['rec1'])
  })

  it.each<OutboxStatus>(['sent', 'dead'])('never returns a %s row', (status) => {
    // `dead` is the attempt cap having been reached, and `sent` is done. Returning
    // either would resend mail somebody already received.
    const rows = [row({ id: 'rec1', status, attempts: 5 })]

    expect(dueOutboxRows(rows, 'recEvt1', NOW, 10)).toEqual([])
  })

  it('lets a failed row climb to the attempt cap across sweeps', () => {
    // The property the old filter destroyed: attempts has to be able to exceed 1.
    for (const attempts of [1, 2, 3, 4]) {
      const rows = [row({ id: 'rec1', status: 'failed', attempts })]
      expect(dueOutboxRows(rows, 'recEvt1', NOW, 10)).toHaveLength(1)
    }
  })
})

describe('the lease pre-filter', () => {
  it('holds back a row whose lease has not lapsed', () => {
    // Not the lock: `claimOnce` and its Durable Object are. This only avoids handing
    // the drain rows it would certainly fail to claim.
    const rows = [row({ id: 'rec1', status: 'failed', attempts: 1, leaseExpiresAt: LATER })]

    expect(dueOutboxRows(rows, 'recEvt1', NOW, 10)).toEqual([])
  })

  it('returns a row whose lease has lapsed, which is how a crashed send is recovered', () => {
    const rows = [row({ id: 'rec1', status: 'failed', attempts: 1, leaseExpiresAt: EARLIER })]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['rec1'])
  })

  it('treats an absent lease as nobody holding it', () => {
    // A queued row has never been claimed, so absent is the normal case there and must
    // not be read as "held forever".
    expect(dueOutboxRows([row({ id: 'rec1' })], 'recEvt1', NOW, 10)).toHaveLength(1)
  })

  it('holds back a sending row whose sender is still inside its lease', () => {
    const rows = [
      row({
        id: 'rec1',
        status: 'sending',
        attempts: 1,
        leaseHolder: 'sweep:A',
        leaseExpiresAt: LATER,
      }),
    ]

    expect(dueOutboxRows(rows, 'recEvt1', NOW, 10)).toEqual([])
  })

  it('returns a sending row whose lease lapsed, because a dead isolate would strand it', () => {
    // `claimOutboxRow` persists `sending` before the provider call, so a sender whose
    // isolate died leaves the row at that status with nothing to move it on. Excluding
    // `sending` by status would make that row neither sendable nor `dead`. Recovering it
    // is safe because the sender that lapsed can no longer overwrite the retry's outcome:
    // `drainOutbox` compares the holder recorded here before it writes.
    const rows = [
      row({
        id: 'rec1',
        status: 'sending',
        attempts: 1,
        leaseHolder: 'sweep:A',
        leaseExpiresAt: EARLIER,
      }),
    ]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['rec1'])
  })

  it('treats a sending row carrying no lease as recoverable rather than held', () => {
    // The claim writes status and both lease columns in one request, so this combination
    // should not arise. If it ever does, unstranding the row is the direction that cannot
    // lose mail: the idempotency key is what makes the extra attempt safe.
    const rows = [row({ id: 'rec1', status: 'sending', attempts: 1 })]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['rec1'])
  })
})

describe('scoping and ordering, unchanged', () => {
  it('ignores another event and anything not yet due', () => {
    const rows = [
      row({ id: 'other', eventId: 'recEvt2' }),
      row({ id: 'future', sendAt: LATER }),
      row({ id: 'mine' }),
    ]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['mine'])
  })

  it('drains oldest first so a backlog does not starve', () => {
    const rows = [
      row({ id: 'newer', sendAt: '2026-08-08T11:30:00.000Z' }),
      row({ id: 'oldest', sendAt: '2026-08-08T10:00:00.000Z', status: 'failed', attempts: 2 }),
    ]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 10))).toEqual(['oldest', 'newer'])
  })

  it('respects the limit after ordering, not before', () => {
    const rows = [
      row({ id: 'newer', sendAt: '2026-08-08T11:30:00.000Z' }),
      row({ id: 'oldest', sendAt: '2026-08-08T10:00:00.000Z' }),
    ]

    expect(ids(dueOutboxRows(rows, 'recEvt1', NOW, 1))).toEqual(['oldest'])
  })
})
