// The mock harness the outbox drain's unit tests share: a row builder and typed `vi.fn` deps.
//
// Extracted when comms-drain.test.ts crossed the file size limit, which happened because two
// branches independently added cases to it and the merge kept both.
//
// tests/helpers/outbox-drain.ts is a DIFFERENT harness and the two are not interchangeable:
// that one drives a real store through a real ClaimGuard for the fencing tests, where the
// interleaving is the subject. This one is mocks, for tests whose subject is what the drain
// calls and with what.

import { vi } from 'vitest'
import type { drainOutbox } from '@/features/comms/drain'
import type { OutboxRow } from '@/types/domain'

export const NOW = 1_754_600_000_000

export function row(over: Partial<OutboxRow> & { id: string }): OutboxRow {
  return {
    eventId: 'recEvt1',
    templateSource: 'template',
    idempotencyKey: `key-${over.id}`,
    toEmail: 'ada@example.com',
    sendAt: '2026-08-08T00:00:00.000Z',
    status: 'queued',
    attempts: 0,
    payload: { subject: 'Accepted', html: '<p>Congratulations</p>', attachIcs: false },
    ...over,
  }
}

export type Args = Parameters<typeof drainOutbox>[0]

export function deps(over: Partial<Args> = {}) {
  // Typed explicitly, so the assertions below read real argument types rather than
  // `any`, which would let a wrong-shaped expectation pass.
  const send = vi.fn<Args['send']>().mockResolvedValue({ delivered: true, messageId: 'msg_1' })
  const markSent = vi.fn<Args['markSent']>().mockResolvedValue(undefined)
  const markFailed = vi.fn<Args['markFailed']>().mockResolvedValue(undefined)
  const claim = vi.fn<Args['claim']>().mockResolvedValue({ granted: true })

  return {
    fns: { send, markSent, markFailed, claim },
    args: {
      listDue: () => Promise.resolve([row({ id: 'rec1' })]),
      claim,
      send,
      markSent,
      markFailed,
      holder: 'run-1',
      nowMs: NOW,
      ...over,
    },
  }
}
