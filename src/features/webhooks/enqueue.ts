// The enqueue half of outbound webhooks: something happened, so write a row per endpoint.
//
// **It enqueues and never POSTs.** That is the same call `EmailOutbox` makes, for the same
// reason, and it is worth stating because POSTing inline is the obvious shortcut and looks
// like it works: the organizer who accepts a submission would be waiting on somebody else's
// HTTP endpoint before their own screen came back, a slow receiver would make bodo slow, an
// endpoint that hangs would hold the isolate until the Workers runtime cancelled the request,
// and a receiver that was down for a minute would simply never hear about the acceptance,
// because a Server Action has nowhere to put a retry. A queue plus a cron drain has all four
// answers, and the retry budget already exists in ./deliver.ts.
//
// The other decision here is the idempotency key, and getting it wrong is not subtle. Airtable
// merges an upsert on `idempotencyKey`, and two subscriptions to the same event type is the
// ordinary case rather than an edge one, so a key derived from the occurrence alone would
// merge both endpoints' rows into one delivery and exactly one of the two would ever be told.
// `webhookDeliveryKey` therefore includes the subscription id, and the caller's `key` supplies
// the rest: it must be stable per state change (`submission.status_changed:recABC:accepted`),
// so a trigger that fires twice enqueues one row per endpoint rather than two.

import {
  prepareWebhookDelivery,
  selectSubscriptions,
  type WebhookDispatch,
  type WebhookEventPayload,
  type WebhookSubscription,
} from '@/features/webhooks/dispatch'
import type { WriteOrigin } from '@/services/airtable/invalidate'
import {
  enqueueWebhookDeliveries,
  type WebhookDeliveryDraft,
} from '@/services/airtable/mutations-webhooks'
import { listWebhooksForDispatch } from '@/services/airtable/reads-webhooks'

/**
 * One delivery's key: the occurrence, then the endpoint it is addressed to.
 *
 * Exported because this is the whole idempotency guarantee of the queue and a collision here
 * is an endpoint that silently never hears about half the events on its subscription.
 */
export function webhookDeliveryKey(occurrenceKey: string, webhookId: string): string {
  return `${occurrenceKey}:${webhookId}`
}

export type WebhookOccurrence = {
  readonly eventId: string
  /** Stable per state change. See the file header: this is what makes a re-fire harmless. */
  readonly key: string
  readonly payload: WebhookEventPayload
  /** Defaults to now. Passed in so a caller replaying a change can date it honestly. */
  readonly occurredAt?: string
}

/**
 * The rows to write for one occurrence, given the subscriptions that exist.
 *
 * Pure apart from the HMAC, and separated from the read and the write for that reason: what
 * is worth testing here is that a muted or unsubscribed endpoint produces nothing, that each
 * endpoint gets its own key, and that the bytes signed are the bytes stored.
 */
export async function webhookDeliveryDrafts(
  subscriptions: readonly WebhookSubscription[],
  occurrence: WebhookOccurrence,
  nowIso: string,
): Promise<readonly WebhookDeliveryDraft[]> {
  const matching = selectSubscriptions(subscriptions, occurrence.payload.type)

  return await Promise.all(
    matching.map(async (subscription) => {
      const deliveryKey = webhookDeliveryKey(occurrence.key, subscription.id)
      const dispatch: WebhookDispatch = {
        // The DELIVERY's key, which is what `X-Bodo-Delivery` carries: a receiver that
        // processed a POST once can drop the retry that follows a timeout it actually
        // handled, and that only works if the value is per endpoint and per occurrence.
        id: deliveryKey,
        eventId: occurrence.eventId,
        occurredAt: occurrence.occurredAt ?? nowIso,
        payload: occurrence.payload,
      }
      // `body` is the string that was signed. Storing anything else, including a
      // re-serialisation of the same object, stores bytes whose signature nobody can
      // reproduce. dispatch.ts rule 1.
      const prepared = await prepareWebhookDelivery(subscription, dispatch)

      return {
        eventId: occurrence.eventId,
        webhookId: subscription.id,
        webhookEvent: occurrence.payload.type,
        idempotencyKey: deliveryKey,
        body: prepared.body,
        // Now, so the next sweep takes it. A future `sendAt` is how a backoff would be
        // expressed if this ever grows one; nothing sets it today.
        sendAt: nowIso,
      }
    }),
  )
}

/**
 * Tell every subscribed endpoint that this happened.
 *
 * Returns counts rather than throwing on an empty result: an event with no webhooks
 * configured is the normal case, and a caller firing this from an accept action must not have
 * to care. Failures of the WRITE do throw, because a delivery that was never queued is one
 * nothing will ever retry.
 */
export async function enqueueWebhookEvent(
  occurrence: WebhookOccurrence,
  origin: WriteOrigin = 'action',
): Promise<{ endpoints: number; queued: number; skipped: number }> {
  const nowIso = new Date().toISOString()
  // Uncached, deliberately: this read decides which endpoints get a row written, so a cached
  // answer enqueues a POST to an endpoint that was deleted a minute ago and misses one that
  // was just added. See the header of reads-webhooks.ts.
  const subscriptions = await listWebhooksForDispatch(occurrence.eventId)
  const drafts = await webhookDeliveryDrafts(subscriptions, occurrence, nowIso)
  if (drafts.length === 0) return { endpoints: 0, queued: 0, skipped: 0 }

  const written = await enqueueWebhookDeliveries(drafts, origin)
  return { endpoints: drafts.length, ...written }
}
