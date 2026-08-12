// Writes to Webhooks and WebhookDeliveries.
//
// **`status`, `leaseHolder` and `leaseExpiresAt` are not a lock here either.** Same statement
// as mutations-outbox.ts, same mechanism, and it has to be repeated rather than referenced
// because the failure it prevents is different on this table: Airtable has no
// compare-and-swap, so two overlapping sweeps can both read a row as `queued` and both write
// `sending`. Claiming is `claimOnce()` in `@/utils/cf.ts`, backed by the ClaimGuard Durable
// Object. These functions PERSIST a decision that was already made there, and anyone reading
// these columns as the grant gets a receiver POSTed twice.
//
// Which writes name a tag, and which name none, is the other thing worth reading here:
//
//   - Every subscription write expires `eventWebhooksTag`, because the settings screen's list
//     is the one cached read in this feature.
//   - A delivery OUTCOME expires it too, because the outcome stamps `lastStatus` and
//     `lastAttemptAt` onto the subscription. Those two columns exist so an organizer can ask
//     "is my endpoint working" without the settings page reading the delivery table at all,
//     and denormalised health that no write expires is health that is always yesterday's.
//   - `enqueueWebhookDeliveries` and `claimWebhookDelivery` expire NOTHING, on purpose. Both
//     touch only WebhookDeliveries, every read of which is uncached by construction
//     (reads-webhooks.ts), so there is no cache entry either one could affect. Naming a tag
//     anyway would make every event fired on the base expire a settings page nobody changed.
//
// `origin` is required rather than defaulted on the delivery writes, exactly as it is on the
// outbox: the sender is a Route Handler reached from a Cron Trigger and the enqueue is called
// from a Server Action, and a default here would hide that these are different places.
//
// **`eventId` on every input here is a RECORD ID, never an event ref.** It is both the value
// the `event` link column is written with and the value `eventWebhooksTag` is built from, and
// a slug is silently wrong for both: Airtable links nothing, and the tag is one no read
// subscribes to. The actions resolve it before calling in; see `eventRecordId` in
// src/features/webhooks/actions.ts.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapWebhook } from '@/services/airtable/mapping-webhooks'
import { existingWebhookDeliveryKeys } from '@/services/airtable/reads-webhooks'
import { onlyRecord } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventWebhooksTag } from '@/services/airtable/tags'
import type { WebhookDeliveryRecord, WebhookRow } from '@/types/webhook'

/** Enough of an error for a receiver's complaint to be debuggable, not enough to fill a cell. */
const ERROR_LIMIT = 500

export type WebhookDraft = {
  readonly eventId: string
  readonly name: string
  readonly url: string
  /** Minted by the caller and stored in the clear, because signing needs the key itself. */
  readonly secret: string
  readonly events: readonly string[]
  readonly enabled: boolean
}

export async function createWebhook(
  draft: WebhookDraft,
  origin: WriteOrigin = 'action',
): Promise<WebhookRow> {
  const created = await getClient().createRecords(TABLES.webhooks, [
    {
      [COL.name]: draft.name,
      [COL.event]: [draft.eventId],
      [COL.url]: draft.url,
      [COL.secret]: draft.secret,
      // A JSON array of strings, not a multi-select: `MetaFieldType` has no multi-select
      // builder, so the DAL validates the vocabulary one layer up. See columns-webhooks.ts.
      [COL.subscribedEventsJson]: JSON.stringify(draft.events),
      [COL.enabled]: draft.enabled,
    },
  ])
  invalidate(origin, { own: [eventWebhooksTag(draft.eventId)] })
  return mapWebhook(onlyRecord(created, TABLES.webhooks))
}

/**
 * Mute or unmute an endpoint.
 *
 * The reason this exists rather than "delete it and add it back" is the secret: it is the one
 * value an organizer cannot recover, so re-creating a subscription means going and changing
 * whatever verifies `X-Bodo-Signature` on the other end. `selectSubscriptions` skips a muted
 * row, so nothing new is enqueued for it while this is off.
 */
export async function setWebhookEnabled(
  input: { webhookId: string; eventId: string; enabled: boolean },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.webhooks, [
    { id: input.webhookId, fields: { [COL.enabled]: input.enabled } },
  ])
  invalidate(origin, { own: [eventWebhooksTag(input.eventId)] })
}

/**
 * Delete a subscription.
 *
 * A real delete rather than a soft one, unlike `revokeApiToken` next door, and the asymmetry
 * is deliberate: a revoked token answers "which credential was live when this happened",
 * which is a question somebody asks later, while a deleted endpoint answers nothing. The
 * organizer who wants the row kept has `setWebhookEnabled` for exactly that.
 *
 * Its queued deliveries are NOT deleted with it, because that means a second listing pass and
 * a second batch write on the path where somebody is waiting for a button to finish. The next
 * sweep retires them to `dead` instead (`retireOrphanedWebhookDeliveries` in
 * reads-webhooks.ts). They used to be silently DROPPED from the due list, which left them
 * `queued` and therefore due forever, and a big enough set of them stalled the whole queue.
 */
export async function deleteWebhook(
  input: { webhookId: string; eventId: string },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().deleteRecords(TABLES.webhooks, [input.webhookId])
  invalidate(origin, { own: [eventWebhooksTag(input.eventId)] })
}

export type WebhookDeliveryDraft = Pick<
  WebhookDeliveryRecord,
  'eventId' | 'webhookEvent' | 'idempotencyKey' | 'body' | 'sendAt'
> & {
  /**
   * Narrowed back to a string, deliberately, and NOT picked off the record type. The record's
   * `webhookId` is optional because a row can OUTLIVE its subscription, which is a thing that
   * happens to a row already in the table. Nothing may CREATE one that way: writing
   * `[undefined]` into the link cell queues a POST with no endpoint to send it to, and the row
   * would be born needing the retirement path.
   */
  readonly webhookId: string
}

/**
 * Queue one POST per subscription, idempotent on `idempotencyKey`.
 *
 * Read-then-upsert, and both halves carry their weight for the reasons `enqueueEmails` spells
 * out. The READ stops a re-enqueue resurrecting a delivery that has already gone: the field
 * set below contains `status: 'queued'` and `attempts: 0`, so upserting blindly over a `sent`
 * row would POST it again. The UPSERT stops a race duplicating: between the read and the
 * write a second trigger can create the same key, and a plain create would make a second row
 * and a second POST.
 *
 * It deduplicates within the batch as well, which is not theoretical here: two subscriptions
 * to the same event type are the ordinary case, so the caller must give each row a key that
 * includes the subscription it belongs to, or Airtable merges the two into one delivery and
 * only one of the two endpoints ever hears about it. `webhookDeliveryKey` in
 * `@/features/webhooks/enqueue` is what mints them.
 */
export async function enqueueWebhookDeliveries(
  drafts: readonly WebhookDeliveryDraft[],
  origin: WriteOrigin,
): Promise<{ queued: number; skipped: number }> {
  void origin
  if (drafts.length === 0) return { queued: 0, skipped: 0 }

  const taken = await existingWebhookDeliveryKeys(drafts.map((draft) => draft.idempotencyKey))
  const seen = new Set<string>()
  const fresh = drafts.filter((draft) => {
    if (taken.has(draft.idempotencyKey) || seen.has(draft.idempotencyKey)) return false
    seen.add(draft.idempotencyKey)
    return true
  })
  if (fresh.length === 0) return { queued: 0, skipped: drafts.length }

  await getClient().upsertRecords(
    TABLES.webhookDeliveries,
    [COL.idempotencyKey],
    fresh.map((draft) => ({
      [COL.idempotencyKey]: draft.idempotencyKey,
      [COL.webhook]: [draft.webhookId],
      [COL.event]: [draft.eventId],
      [COL.webhookEvent]: draft.webhookEvent,
      [COL.payloadJson]: draft.body,
      [COL.sendAt]: draft.sendAt,
      [COL.status]: 'queued',
      [COL.attempts]: 0,
    })),
  )
  return { queued: fresh.length, skipped: drafts.length - fresh.length }
}

/**
 * Record that a delivery is in flight.
 *
 * Call this ONLY after `claimOnce('webhook-delivery:<rowId>', holder, ttl)` granted. It does
 * not check, because it cannot: see the header.
 */
export async function claimWebhookDelivery(
  input: { rowId: string; leaseHolder: string; leaseExpiresAt: string; attempts: number },
  origin: WriteOrigin,
): Promise<void> {
  void origin
  await getClient().updateRecords(TABLES.webhookDeliveries, [
    {
      id: input.rowId,
      fields: {
        [COL.status]: 'sending',
        [COL.attempts]: input.attempts,
        [COL.leaseHolder]: input.leaseHolder,
        [COL.leaseExpiresAt]: input.leaseExpiresAt,
      },
    },
  ])
}

type DeliveryOutcome = {
  rowId: string
  webhookId: string
  eventId: string
  attempts: number
  /** The receiver's HTTP status as text. Empty when there was no response at all. */
  status: string
  at: string
}

/**
 * The delivery's own outcome plus the subscription's health, in that order.
 *
 * Two writes rather than one because they are two tables, and the delivery goes FIRST on
 * purpose: it is the row the drain's fence protects and the row a retry is decided from, so
 * if the isolate dies between the two the worse thing to have skipped is the terminal status,
 * not a cosmetic timestamp on a settings screen.
 */
async function writeOutcome(
  outcome: DeliveryOutcome,
  fields: Record<string, unknown>,
  origin: WriteOrigin,
): Promise<void> {
  const client = getClient()
  await client.updateRecords(TABLES.webhookDeliveries, [{ id: outcome.rowId, fields }])
  await client.updateRecords(TABLES.webhooks, [
    {
      id: outcome.webhookId,
      fields: { [COL.lastStatus]: outcome.status, [COL.lastAttemptAt]: outcome.at },
    },
  ])
  invalidate(origin, { own: [eventWebhooksTag(outcome.eventId)] })
}

/** Terminal success. The lease is released, because the delivery is over. */
export async function markWebhookDeliverySent(
  outcome: DeliveryOutcome,
  origin: WriteOrigin,
): Promise<void> {
  await writeOutcome(
    outcome,
    {
      [COL.status]: 'sent',
      [COL.attempts]: outcome.attempts,
      [COL.sentAt]: outcome.at,
      [COL.lastStatus]: outcome.status,
      // Cleared, not left behind: a `sent` row carrying the 500 from attempt three reads as
      // a delivery that failed, which is the opposite of what happened.
      [COL.lastError]: '',
      [COL.leaseHolder]: '',
    },
    origin,
  )
}

export async function markWebhookDeliveryFailed(
  outcome: DeliveryOutcome & { error: string; dead: boolean },
  origin: WriteOrigin,
): Promise<void> {
  if (outcome.attempts < 1) {
    // A failure that attempted nothing means the caller lost track of the row it was working
    // on, and writing it would make the delivery history lie about why.
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'a webhook failure needs at least one attempt', {
      rowId: outcome.rowId,
    })
  }

  await writeOutcome(
    outcome,
    {
      // `failed` is retried once the lease lapses; `dead` never is. The cap that decides
      // between them is the drain's policy (WEBHOOK_MAX_ATTEMPTS), not this layer's.
      [COL.status]: outcome.dead ? 'dead' : 'failed',
      [COL.attempts]: outcome.attempts,
      [COL.lastStatus]: outcome.status,
      [COL.lastError]: outcome.error.slice(0, ERROR_LIMIT),
      [COL.leaseHolder]: '',
    },
    origin,
  )
}
