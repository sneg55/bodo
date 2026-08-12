// Where the outbox drain meets the data layer, the mail provider, and the claim guard.
//
// `features/comms/drain.ts` takes all three as arguments so the interleavings it exists to
// survive can be tested without a base, a Resend key, or a Durable Object. This is the one
// place that indirection is resolved. Split out of `reminders-wiring.ts`, which is about
// what is DUE; this file is about what is SENT, and the two now have different scopes:
// the enqueue halves run once per event, this runs once for the whole base.
//
// Every write here names `eventOf(rowId)` rather than a fixed event, and that is the whole
// reason the file changed. A drain that covers the base sees rows from several events in
// one pass, so an outcome write tagged with the sweep's event would expire the wrong
// event's Comms screen and leave the right one serving a stale entry.

import type { DrainDeps } from '@/features/comms/drain'
import { outboxLease } from '@/features/comms/outbox-lease'
import { inviteAttachments, roomNameOf } from '@/features/jobs/invite-attachment'
import { markOutboxFailed, markOutboxSent } from '@/services/airtable/mutations-outbox'
import { getSubmission } from '@/services/airtable/queries'
import { listDueOutbox } from '@/services/airtable/reads-portal'
import { sendEmail } from '@/services/email/send'
import type { OutboxRow } from '@/types/domain'
import { claimOnce } from '@/utils/cf'

/**
 * Rows per sweep.
 *
 * The schedule is every five minutes, so this is a ceiling on one run rather than on the
 * queue: a backlog drains oldest-first over several sweeps. It is bounded at all because
 * each row costs a provider call plus an Airtable write, and Airtable allows 5 requests a
 * second per base, so an unbounded run would spend the whole isolate backing off.
 *
 * It is a whole-base ceiling now rather than a per-event one, and deliberately so. Draining
 * 25 rows per event would let one event with a large backlog set the pace for the isolate;
 * oldest-first across the base is what makes the bound fair between events.
 */
const DRAIN_LIMIT = 25

/**
 * Everything `drainOutbox` needs except the holder, which the sweep mints.
 *
 * `eventId` is `undefined` for the Cron Trigger, which names no event and therefore drains
 * every event's due mail in one pass, and set only for the admin "run now" button. It is
 * NOT a filter that happens to default to everything: `listDueOutbox` reads the whole
 * outbox table in one request either way, so narrowing it saves no request and would only
 * hide rows.
 */
export function drainDeps(eventId: string | undefined, nowMs: number): Omit<DrainDeps, 'holder'> {
  // Per invocation, so it is not module state that an isolate could carry between
  // requests. `drainOutbox` hands `markSent` a row id and nothing else, while the DAL
  // records `attempts` alongside the outcome, so the count is captured from the rows this
  // run actually read rather than re-read per row.
  const attempts = new Map<string, number>()
  // The same trick for the row's OWN event, which is what every outcome write has to name
  // now that one drain covers the whole base. `eventId` is only a fallback for the admin
  // button's scoped run; every row the drain touches came from `listDue` and is in here.
  const events = new Map<string, string>()
  const eventOf = (rowId: string): string => events.get(rowId) ?? eventId ?? ''

  return {
    listDue: async () => {
      const rows = await listDueOutbox(eventId, new Date(nowMs).toISOString(), DRAIN_LIMIT)
      for (const row of rows) {
        attempts.set(row.id, row.attempts)
        events.set(row.id, row.eventId)
      }
      return rows
    },
    claim: claimOnce,
    // Records the claim on the row and reads back who holds it, so an outcome write is
    // abandoned when this sender's lease has already been taken over. Without this the
    // fence in `drainOutbox` is inert: `stillHolds` returns true when `lease` is absent,
    // which is what keeps the unfenced path working, and would also have quietly kept the
    // whole protection switched off in production.
    lease: outboxLease(eventOf),
    send: sendEmail,
    buildAttachments: (row: OutboxRow) =>
      inviteAttachments(row, {
        // The row's event, not the sweep's. An invite names a room, `roomNameOf` looks it
        // up per event, and a cross-event drain that asked the wrong event for a room id
        // would raise MAIL_ICS_INVALID, which is one of the three PERMANENT failures: the
        // row would die on its first attempt rather than retry.
        eventId: row.eventId,
        loadSubmission: getSubmission,
        loadRoomName: roomNameOf,
      }),
    markSent: (rowId, providerMessageId, sentAt, speakerId) =>
      markOutboxSent(
        {
          rowId,
          eventId: eventOf(rowId),
          attempts: (attempts.get(rowId) ?? 0) + 1,
          sentAt,
          providerMessageId,
          speakerId,
        },
        'route',
      ),
    markFailed: ({ rowId, attempts: attemptCount, error, dead, speakerId }) =>
      markOutboxFailed(
        {
          rowId,
          eventId: eventOf(rowId),
          attempts: attemptCount,
          lastError: error,
          status: dead ? 'dead' : 'failed',
          speakerId,
        },
        'route',
      ),
    nowMs,
  }
}
