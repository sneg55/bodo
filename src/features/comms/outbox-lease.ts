// The row's half of the outbox lease, assembled out of real DAL calls.
//
// `drain.ts` takes the lease as two injected functions so the interleavings it exists to
// survive can be tested without a base or a Durable Object (tests/comms-drain-fencing.test.ts).
// This is the one place those two become the claim write and the read that fences on it.
//
// They are paired here rather than spelled out at the call site on purpose: `record`
// without `heldBy` advertises a fence that never runs, and `heldBy` without `record` finds
// no holder on any row and so abandons every outcome write. Neither half is useful alone,
// so neither half is wireable alone.
//
// `'route'` because the sender is a Route Handler reached from a Cron Trigger, which is
// what the sweep's other outbox writes pass (see the header of mutations-outbox.ts).

import type { OutboxLease } from '@/features/comms/drain'
import { claimOutboxRow } from '@/services/airtable/mutations-outbox'
import { outboxLeaseHolder } from '@/services/airtable/reads-portal'

/**
 * `eventOf` resolves the row's OWN event rather than closing over a single one.
 *
 * The event id is only ever used to expire that event's outbox tag, so a lease built
 * around one fixed event would tag every claim with it. That was harmless while the sweep
 * could only ever see one event's rows and became wrong the moment it drains all of them:
 * the Comms screen of the event whose row is in flight would keep serving a stale entry
 * while some other event's got expired for nothing. The caller resolves it from the due
 * list it has already read, so this still costs no extra request.
 */
export function outboxLease(eventOf: (rowId: string) => string): OutboxLease {
  return {
    record: ({ rowId, holder, leaseExpiresAt, attempts, speakerId }) =>
      claimOutboxRow(
        {
          rowId,
          eventId: eventOf(rowId),
          leaseHolder: holder,
          leaseExpiresAt,
          attempts,
          speakerId,
        },
        'route',
      ),
    heldBy: outboxLeaseHolder,
  }
}
