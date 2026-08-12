// The outbox's one promise: enqueue the same key twice and the recipient gets one email.
//
// This is the pure half of `enqueueEmails`. The other half is an Airtable upsert merged
// on `idempotencyKey`, and the two are doing different jobs: the read-and-filter below
// stops a re-enqueue from resurrecting mail that has already been SENT (the create field
// set carries `status: 'queued'` and `attempts: 0`, so writing it over a sent row would
// send it again), and the upsert stops a RACE from duplicating, because between the read
// and the write a second Notify click can create the same key.

import { describe, expect, it } from 'vitest'

import { unqueuedRows } from '@/services/airtable/mutations-outbox'
import type { OutboxDraft } from '@/services/airtable/to-fields-portal'

function draft(key: string, toEmail = 'ada@example.com'): OutboxDraft {
  return {
    eventId: 'recEvent1',
    templateSource: 'template',
    idempotencyKey: key,
    payload: { subject: 'You are in', html: '<p>Congratulations</p>', attachIcs: false },
    toEmail,
    sendAt: '2026-08-08T09:00:00.000Z',
  }
}

describe('unqueuedRows', () => {
  it('keeps rows whose key the table has never seen', () => {
    const rows = [draft('accepted:recSub1:t0'), draft('accepted:recSub2:t0')]
    expect(unqueuedRows(rows, new Set())).toEqual(rows)
  })

  it('drops a key the table already holds, with no write at all', () => {
    // The row may already be `sent`. Re-writing the create field set over it would put
    // it back in the queue, and the speaker would be congratulated twice.
    const rows = [draft('accepted:recSub1:t0'), draft('accepted:recSub2:t0')]
    const fresh = unqueuedRows(rows, new Set(['accepted:recSub1:t0']))
    expect(fresh.map((row) => row.idempotencyKey)).toEqual(['accepted:recSub2:t0'])
  })

  it('deduplicates inside one batch as well', () => {
    // Two records with the same key in one upsert request both merge onto one row, so
    // the second is dropped here rather than left to Airtable.
    const fresh = unqueuedRows([draft('cohort:s1:recSpk1'), draft('cohort:s1:recSpk1')], new Set())
    expect(fresh).toHaveLength(1)
  })

  it('keeps one row per recipient, because the key is per recipient', () => {
    // Section 5.3: "each participant" means every SubmissionParticipants row, so a
    // co-speaker gets their own acceptance email under their own key.
    const fresh = unqueuedRows(
      [
        draft('accepted:recSub1:t0:recSpk1', 'ada@example.com'),
        draft('accepted:recSub1:t0:recSpk2', 'bruno@example.com'),
      ],
      new Set(),
    )
    expect(fresh.map((row) => row.toEmail)).toEqual(['ada@example.com', 'bruno@example.com'])
  })

  it('answers empty when every key is already queued', () => {
    const rows = [draft('confirm:recSub1')]
    expect(unqueuedRows(rows, new Set(['confirm:recSub1']))).toEqual([])
  })

  it('re-arms a reminder whose key changed with the deadline', () => {
    // The draft-reminder key includes `closeDate`, so moving the deadline is a new key
    // and a new reminder rather than one suppressed forever.
    const taken = new Set(['draft-remind:recSub1:2026-09-15T23:59:00.000Z'])
    const fresh = unqueuedRows([draft('draft-remind:recSub1:2026-09-22T23:59:00.000Z')], taken)
    expect(fresh).toHaveLength(1)
  })
})
