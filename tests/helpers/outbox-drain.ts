// A fake EmailOutbox and a fake claim guard, for the drain's concurrency tests.
//
// Extracted rather than inlined because two senders sharing one row is the setup, and the
// setup is bigger than the assertions: a store the writes actually land in, a ClaimGuard per
// key, and a sender factory that hands both to `drainOutbox`. The tests that use it read as
// interleavings instead of as plumbing (tests/comms-drain-fencing.test.ts).

import { type DrainDeps, LEASE_MS } from '@/features/comms/drain'
import { dueOutboxRows } from '@/services/airtable/reads-portal'
import type { SendResult } from '@/services/email/send'
import { ClaimGuard } from '@/services/guard/claim-guard'
import type { OutboxRow } from '@/types/domain'

/** Fixed epoch ms. Nothing here reads the clock, so an interleaving is deterministic. */
export const NOW = 1_754_600_000_000
export const EVENT = 'recEvt1'
export const LAPSED = NOW + LEASE_MS + 1
/** Before `NOW`, because these rows go through the real due filter and have to pass it. */
export const SEND_AT = new Date(NOW - 3_600_000).toISOString()

export function row(over: Partial<OutboxRow> & { id: string }): OutboxRow {
  return {
    eventId: EVENT,
    templateSource: 'template',
    idempotencyKey: `key-${over.id}`,
    toEmail: 'ada@example.com',
    sendAt: SEND_AT,
    status: 'queued',
    attempts: 0,
    payload: { subject: 'Accepted', html: '<p>Congratulations</p>', attachIcs: false },
    ...over,
  }
}

/**
 * A fake EmailOutbox: the lease columns, the outcome columns, and the real due filter.
 *
 * The terminal writes clear `leaseHolder` and `leaseExpiresAt` because that is what the DAL
 * does with an absent value (`outboxOutcomeFields`), and the due list runs the real
 * `dueOutboxRows`, so a recovery asserted here is a recovery in production.
 */
export function outbox(initial: OutboxRow) {
  const rows = new Map<string, OutboxRow>([[initial.id, initial]])
  const patch = (id: string, over: Partial<OutboxRow>): void => {
    rows.set(id, { ...rows.get(id)!, ...over })
  }
  const released = { leaseHolder: undefined, leaseExpiresAt: undefined }

  const lease: NonNullable<DrainDeps['lease']> = {
    record: ({ rowId, holder, leaseExpiresAt, attempts }) => {
      patch(rowId, { status: 'sending', leaseHolder: holder, leaseExpiresAt, attempts })
      return Promise.resolve()
    },
    heldBy: (rowId) => Promise.resolve(rows.get(rowId)?.leaseHolder),
  }

  const markSent: DrainDeps['markSent'] = (rowId, providerMessageId, sentAt) => {
    patch(rowId, { status: 'sent', providerMessageId, sentAt, ...released })
    return Promise.resolve()
  }

  const markFailed: DrainDeps['markFailed'] = ({ rowId, attempts, error, dead }) => {
    patch(rowId, { status: dead ? 'dead' : 'failed', attempts, lastError: error, ...released })
    return Promise.resolve()
  }

  return {
    row: (id: string) => rows.get(id)!,
    due: (atMs: number) =>
      dueOutboxRows([...rows.values()], EVENT, new Date(atMs).toISOString(), 10),
    lease,
    markSent,
    markFailed,
  }
}

export function guardOverAMap(): ClaimGuard {
  const storage = new Map<string, unknown>()
  return new ClaimGuard({
    storage: {
      get: <T>(key: string) => Promise.resolve(storage.get(key) as T | undefined),
      put: <T>(key: string, value: T) => {
        storage.set(key, value)
        return Promise.resolve()
      },
      delete: (key: string) => Promise.resolve(storage.delete(key)),
      deleteAll: () => {
        storage.clear()
        return Promise.resolve()
      },
      setAlarm: () => Promise.resolve(),
    },
  })
}

/** One guard per key, because that is what `idFromName` gives each row in production. */
export function claims(): (atMs: number) => DrainDeps['claim'] {
  const guards = new Map<string, ClaimGuard>()

  return (atMs) => async (key, holder, ttlMs) => {
    const guard = guards.get(key) ?? guardOverAMap()
    guards.set(key, guard)
    return await guard.claim({ holder, ttlMs }, atMs)
  }
}

/** Senders sharing one store and one set of claim guards, which is what contention is. */
export function senders(store: ReturnType<typeof outbox>, claim: ReturnType<typeof claims>) {
  return (holder: string, atMs: number, over: Partial<DrainDeps> = {}): DrainDeps => ({
    listDue: () => Promise.resolve(store.due(atMs)),
    claim: claim(atMs),
    lease: store.lease,
    markSent: store.markSent,
    markFailed: store.markFailed,
    send: () => Promise.resolve({ delivered: true, messageId: `msg-${holder}` }),
    holder,
    nowMs: atMs,
    ...over,
  })
}

/** A provider call that never answers, which is what a dead isolate looks like. */
export function neverSettles(): Promise<SendResult> {
  return new Promise(() => undefined)
}

/** Let a suspended drain reach its gate before the next sender starts. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A promise a fake can park on, so a sender can be suspended mid-flight on purpose. */
export function gate(): { open: () => void; wait: Promise<void> } {
  let open = (): void => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}
