// The lease fence: what happens when a sender comes back after losing its row.
//
// One interleaving is the reason it exists. Sender A claims a failed row, stalls building
// an invite, and its lease lapses. Sender B claims the same row, sends it, marks it `sent`.
// A then returns with a provider error, and its write is unconditional, so the row goes
// back to `failed` at a higher attempt count. Because `dueOutboxRows` retries `failed`, the
// mail gets a further provider call it did not need. The delivery is collapsed by the
// idempotency key; the row's lifecycle is not, and that is what is fixed here.
//
// The fakes are in tests/helpers/outbox-drain.ts: a store the writes land in rather than
// mocked calls, because the property under test is what the ROW says after two senders have
// both written to it, and the real ClaimGuard over a Map, because a stubbed `granted: true`
// cannot show a lease lapsing.

import { describe, expect, it } from 'vitest'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { drainOutbox, LEASE_MS, MAX_ATTEMPTS } from '@/features/comms/drain'
import type { OutboxRow } from '@/types/domain'
import {
  claims,
  gate,
  LAPSED,
  NOW,
  neverSettles,
  outbox,
  row,
  senders,
  settle,
} from './helpers/outbox-drain'

const PROVIDER_DOWN = new AppError(ErrorIds.MAIL_SEND_FAIL, 'provider 500', {})

describe('a sender that comes back after its lease lapsed', () => {
  it('cannot regress a row the next sender already marked sent', async () => {
    const store = outbox(row({ id: 'rec1', status: 'failed', attempts: 3 }))
    const drain = senders(store, claims())
    const stall = gate()

    const senderA = drainOutbox(
      drain('sweep:A', NOW, {
        // The invite build is where the real stall lives: it sits between the claim and
        // the provider call, and it is slow enough to outlast a lease.
        buildAttachments: () => stall.wait.then(() => undefined),
        send: () => Promise.reject(PROVIDER_DOWN),
      }),
    )
    await settle()

    // A holds it, and the row now says so. Before this change nothing wrote `sending`, so
    // an in-flight row looked queued on the Comms screen and left nothing to fence on.
    expect(store.row('rec1')).toMatchObject({
      status: 'sending',
      leaseHolder: 'sweep:A',
      attempts: 4,
    })

    const senderB = await drainOutbox(drain('sweep:B', LAPSED))

    // B got the row at all only because a lapsed `sending` row is due again.
    expect(senderB).toMatchObject({ claimed: 1, sent: 1, skipped: 0, fenced: 0 })
    expect(store.row('rec1')).toMatchObject({
      status: 'sent',
      providerMessageId: 'msg-sweep:B',
      // Attempt 4 was A's, which it burned by claiming and never finishing. Attempt 5 is
      // B's, and it is the one that landed.
      attempts: 5,
      leaseHolder: undefined,
    })

    stall.open()

    expect(await senderA).toMatchObject({ claimed: 1, fenced: 1, failed: 0, dead: 0, sent: 0 })
    expect(store.row('rec1')).toMatchObject({ status: 'sent', providerMessageId: 'msg-sweep:B' })
    expect(store.row('rec1').lastError).toBeUndefined()
    // The second half of the defect: a regressed row is a due row, and a due row is
    // another provider call.
    expect(store.due(LAPSED + 1)).toEqual([])
  })

  it('overwrites that row when the fence is not wired, which is the bug being fixed', async () => {
    // The same interleaving with `lease` absent, kept as the witness. Delete the fence and
    // this is what comes back.
    const store = outbox(row({ id: 'rec1', status: 'failed', attempts: 3 }))
    const drain = senders(store, claims())
    const stall = gate()

    const senderA = drainOutbox(
      drain('sweep:A', NOW, {
        lease: undefined,
        buildAttachments: () => stall.wait.then(() => undefined),
        send: () => Promise.reject(PROVIDER_DOWN),
      }),
    )
    await settle()

    await drainOutbox(drain('sweep:B', LAPSED, { lease: undefined }))
    expect(store.row('rec1').status).toBe('sent')

    stall.open()
    expect(await senderA).toMatchObject({ failed: 1, fenced: 0 })

    expect(store.row('rec1')).toMatchObject({ status: 'failed', attempts: 4 })
    expect(store.due(LAPSED + 1).map((each) => each.id)).toEqual(['rec1'])
  })
})

describe('the ordinary single-sender path', () => {
  it('records sending with its holder before the send, then the outcome', async () => {
    const store = outbox(row({ id: 'rec1' }))
    const inFlight: OutboxRow[] = []

    const result = await drainOutbox(
      senders(store, claims())('sweep:A', NOW, {
        send: () => {
          inFlight.push(store.row('rec1'))
          return Promise.resolve({ delivered: true, messageId: 'msg_1' })
        },
      }),
    )

    expect(result).toMatchObject({ claimed: 1, sent: 1, fenced: 0 })
    expect(inFlight.at(0)).toMatchObject({
      status: 'sending',
      leaseHolder: 'sweep:A',
      leaseExpiresAt: new Date(NOW + LEASE_MS).toISOString(),
      attempts: 1,
    })
    expect(store.row('rec1')).toMatchObject({
      status: 'sent',
      providerMessageId: 'msg_1',
      leaseHolder: undefined,
      leaseExpiresAt: undefined,
    })
  })

  it('still reaches dead at the cap, so the fence adds no way to sit in limbo', async () => {
    const store = outbox(row({ id: 'rec1', attempts: MAX_ATTEMPTS - 1 }))

    const result = await drainOutbox(
      senders(store, claims())('sweep:A', NOW, { send: () => Promise.reject(PROVIDER_DOWN) }),
    )

    expect(result).toMatchObject({ dead: 1, fenced: 0 })
    expect(store.row('rec1')).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS })
    expect(store.due(LAPSED)).toEqual([])
  })
})

describe('a sender that never comes back', () => {
  it('leaves a sending row that is recovered once the lease lapses', async () => {
    const store = outbox(row({ id: 'rec1' }))
    // The isolate dies mid-send: the claim is on the row and no outcome ever follows it.
    // A send that never settles is exactly the state that leaves behind.
    void drainOutbox(senders(store, claims())('sweep:A', NOW, { send: neverSettles }))
    await settle()

    expect(store.row('rec1').status).toBe('sending')
    // Held: another sweep inside the lease leaves it alone.
    expect(store.due(NOW + 1)).toEqual([])
    // Lapsed: recoverable rather than stranded at `sending` for ever.
    expect(store.due(LAPSED).map((each) => each.id)).toEqual(['rec1'])
  })

  it('abandons an outcome it cannot fence rather than guessing, and leaves the row due', async () => {
    const store = outbox(row({ id: 'rec1' }))

    const result = await drainOutbox(
      senders(store, claims())('sweep:A', NOW, {
        lease: {
          record: store.lease.record,
          heldBy: () => Promise.reject(new AppError(ErrorIds.NET_UNAVAILABLE, 'airtable 502', {})),
        },
      }),
    )

    // The mail went out and the row does not know it. That is the safe direction: the row
    // is still due, and the next attempt collapses at the provider on the idempotency key.
    expect(result).toMatchObject({ sent: 0, fenced: 1 })
    expect(store.row('rec1').status).toBe('sending')
    expect(store.due(LAPSED).map((each) => each.id)).toEqual(['rec1'])
  })
})
