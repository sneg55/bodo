// EmailOutbox writes: enqueue, and record what the sender did.
//
// **The status column is not a lock.** Airtable has no transaction and no
// compare-and-swap, so two overlapping cron invocations can both read a row as
// `queued`, both write `sending`, and both send. Nothing in this file prevents that and
// nothing in it is trying to: atomic claiming is `claimOnce()` in `@/utils/cf.ts`,
// backed by the ClaimGuard Durable Object, which serializes requests per key. These
// functions PERSIST the outcome of a decision that was already made there. Anyone
// reading `status`, `leaseHolder`, or `leaseExpiresAt` as the thing that grants the
// lease has the design backwards, and the bug it produces is a speaker receiving the
// same acceptance email twice. BUILD_SPEC 3 and 5.3.
//
// `origin` is required on every function here rather than defaulting to `'action'`. It
// stopped changing what invalidation does when `updateTag` went away (see `WriteOrigin`
// in invalidate.ts), but it stays required because these two callers are genuinely
// different places: the sender is a Route Handler reached from a Cron Trigger and the
// Notify step is a Server Action, and a default here would hide that.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { existingOutboxKeys } from '@/services/airtable/reads-portal'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventOutboxTag, speakerCommsTag } from '@/services/airtable/tags'
import {
  type OutboxDraft,
  type OutboxOutcome,
  outboxFields,
  outboxOutcomeFields,
} from '@/services/airtable/to-fields-portal'
import type { RecordId } from '@/types/domain'

export type EnqueueResult = { queued: number; skipped: number }

/**
 * The rows that are genuinely new, given the keys the table already holds.
 *
 * Pure, and exported, because this is the whole idempotency guarantee of the outbox and
 * an off-by-one here is a speaker receiving the same acceptance email twice. It
 * deduplicates against the batch as well as against the table: one caller building two
 * rows with the same key is the same message twice, and an upsert with both of them in
 * one request has two records merging onto one row.
 */
export function unqueuedRows(
  rows: readonly OutboxDraft[],
  taken: ReadonlySet<string>,
): readonly OutboxDraft[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (taken.has(row.idempotencyKey) || seen.has(row.idempotencyKey)) return false
    seen.add(row.idempotencyKey)
    return true
  })
}

/**
 * Queue one row per recipient, idempotent on `idempotencyKey`.
 *
 * Read-then-upsert, and both halves are load-bearing:
 *
 *   - The READ is what stops a re-enqueue from resurrecting mail that has already
 *     gone out. `performUpsert` writes the given field set to a matched row too, and
 *     that field set contains `status: 'queued'` and `attempts: 0`, so upserting blindly
 *     over a `sent` row would put it back in the queue and send it again. A key that
 *     already exists is therefore skipped entirely, with no write at all.
 *   - The UPSERT is what stops a race from duplicating. Between the read and the write
 *     a second Notify click or an overlapping sweep can create the same key; a plain
 *     create would then make a second row and the speaker would get two emails.
 *     Merging on `idempotencyKey` works here, and only here, because it is a real text
 *     column: Airtable merges on field VALUES, and a linked record's value is its
 *     primary field's text, which is why the review tables read-then-write instead
 *     (mutations-review.ts).
 *
 * Batched at 10 by the client, which is Airtable's ceiling, so a cohort send of forty
 * recipients is four requests through the scheduler.
 *
 * Names `speakerCommsTag` for every distinct speaker among the rows just queued, the same
 * way it collects distinct event ids: `listOutboxForSpeaker` (reads-crm.ts) returns a row
 * in ANY status, including `queued`, so the CRM timeline goes stale the moment a send is
 * queued if only `eventOutboxTag` is expired here.
 *
 * The upsert is inside a `try`/`finally`, same shape as `setSpeakerTags`: `client.ts`
 * writes a chunked call's requests SEQUENTIALLY, so a 25-recipient enqueue that lands its
 * first ten rows and then throws on the second request would, without this, propagate
 * before `invalidate` ever ran - leaving those ten speakers' cached timelines and the
 * event's cached outbox with no way to learn the queue changed. Invalidating unconditionally
 * for all of `fresh` on the way out, not only the rows confirmed written, is deliberate:
 * once a batch call has thrown partway through, there is no cheap way to know exactly which
 * of its requests landed, and a stale cache is the worse failure to risk.
 */
export async function enqueueEmails(
  rows: readonly OutboxDraft[],
  origin: WriteOrigin,
): Promise<EnqueueResult> {
  if (rows.length === 0) return { queued: 0, skipped: 0 }

  const fresh = unqueuedRows(rows, await existingOutboxKeys(rows.map((row) => row.idempotencyKey)))
  if (fresh.length === 0) return { queued: 0, skipped: rows.length }

  try {
    await getClient().upsertRecords(
      TABLES.emailOutbox,
      [COL.idempotencyKey],
      fresh.map(outboxFields),
    )
  } finally {
    const speakerIds = fresh.flatMap((row) => (row.speakerId === undefined ? [] : [row.speakerId]))
    invalidate(origin, {
      own: [
        ...new Set(fresh.map((row) => eventOutboxTag(row.eventId))),
        ...new Set(speakerIds.map(speakerCommsTag)),
      ],
    })
  }
  return { queued: fresh.length, skipped: rows.length - fresh.length }
}

export type OutboxWrite = {
  rowId: RecordId
  /** Carried by the caller so recording an outcome costs no extra read. */
  eventId: RecordId
}

async function writeOutcome(
  write: OutboxWrite,
  outcome: OutboxOutcome,
  origin: WriteOrigin,
  extraOwnTags: readonly string[] = [],
): Promise<void> {
  await getClient().updateRecords(TABLES.emailOutbox, [
    { id: write.rowId, fields: outboxOutcomeFields(outcome) },
  ])
  invalidate(origin, { own: [eventOutboxTag(write.eventId), ...extraOwnTags] })
}

export type OutboxClaim = OutboxWrite & {
  /** Whoever won `claimOnce()`. Recorded, never trusted as the grant. */
  leaseHolder: string
  leaseExpiresAt: string
  /** The attempt this send is, counted by the caller that read the row. */
  attempts: number
  /**
   * Same reasoning as `OutboxSent.speakerId`: `listOutboxForSpeaker` returns a row in any
   * status, including `sending`, so without this the CRM timeline keeps showing `queued`
   * while the send is genuinely in flight, until some later terminal write finally expires
   * it.
   */
  speakerId?: string
}

/**
 * Record that a row is being sent.
 *
 * Call this ONLY after `claimOnce('outbox:<rowId>', holder, ttl)` returned
 * `granted: true`. It does not check, because it cannot: see the header.
 */
export async function claimOutboxRow(claim: OutboxClaim, origin: WriteOrigin): Promise<void> {
  await writeOutcome(
    claim,
    {
      status: 'sending',
      attempts: claim.attempts,
      leaseHolder: claim.leaseHolder,
      leaseExpiresAt: claim.leaseExpiresAt,
    },
    origin,
    claim.speakerId === undefined ? [] : [speakerCommsTag(claim.speakerId)],
  )
}

export type OutboxSent = OutboxWrite & {
  attempts: number
  sentAt: string
  /** Resend's id, so a delivery question has something to look up. */
  providerMessageId?: string
  /**
   * Present when the row addressed one speaker. `speakerId` is optional on `OutboxRow`
   * (a system-wide notice may have none), so this is expired only when there is a speaker
   * to expire it for; without this the CRM timeline, which reads `speakerCommsTag` and not
   * `eventOutboxTag`, would keep serving a stale view after the send it exists to show.
   */
  speakerId?: string
}

/** Terminal success. The lease is released, because the send is over. */
export async function markOutboxSent(sent: OutboxSent, origin: WriteOrigin): Promise<void> {
  await writeOutcome(
    sent,
    {
      status: 'sent',
      attempts: sent.attempts,
      sentAt: sent.sentAt,
      providerMessageId: sent.providerMessageId,
    },
    origin,
    sent.speakerId === undefined ? [] : [speakerCommsTag(sent.speakerId)],
  )
}

export type OutboxFailure = OutboxWrite & {
  attempts: number
  lastError: string
  /**
   * `failed` is retried once the lease lapses; `dead` never is. The attempt cap that
   * decides between them is the sender's policy, not this layer's, because the DAL has
   * no business knowing how many times a provider deserves.
   */
  status: 'failed' | 'dead'
  /**
   * Same reasoning as `OutboxSent.speakerId`: `listOutboxForSpeaker` returns a row in any
   * status, including `failed` and `dead`, so without this the CRM timeline keeps showing
   * `sending` forever after a send has permanently failed.
   */
  speakerId?: string
}

export async function markOutboxFailed(failure: OutboxFailure, origin: WriteOrigin): Promise<void> {
  if (failure.attempts < 1) {
    // A failure that never attempted anything means the caller lost track of the row it
    // was working on, and writing it would make the Comms log lie about why.
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'an outbox failure needs at least one attempt', {
      rowId: failure.rowId,
    })
  }

  await writeOutcome(
    failure,
    {
      status: failure.status,
      attempts: failure.attempts,
      lastError: failure.lastError.slice(0, 500),
    },
    origin,
    failure.speakerId === undefined ? [] : [speakerCommsTag(failure.speakerId)],
  )
}
