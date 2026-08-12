// The webhook shapes above Airtable's spelling: a subscription once it has been read, and one
// queued POST before its endpoint is joined onto it.
//
// `WebhookSubscription` is deliberately NOT redefined here. It belongs to
// `@/features/webhooks/dispatch`, which is the module that decides what a subscription MEANS:
// `url`, `secret`, `events` and `enabled` are exactly the fields `selectSubscriptions` and
// `prepareWebhookDelivery` act on, and a second declaration of them here would be free to
// drift from the one doing the acting. What this file adds is everything the pure dispatcher
// has no opinion about: the name an organizer typed, and the endpoint health denormalised off
// the newest delivery.

import type { OutboxStatus } from '@/constants/status'
import type { WebhookEventType, WebhookSubscription } from '@/features/webhooks/dispatch'

/** One Webhooks row, as the DAL hands it back. */
export type WebhookRow = WebhookSubscription & {
  /** The primary field, which is what every linked-record chip in the base renders. */
  readonly name: string
  /**
   * The last HTTP status this endpoint answered, as TEXT rather than a number: the failures
   * an organizer most needs to see (a timeout, a refused connection, DNS) have no status at
   * all, and a number column can only render those as empty, which reads as "never tried".
   */
  readonly lastStatus: string | undefined
  readonly lastAttemptAt: string | undefined
}

/**
 * A subscription as the settings page shows it: no secret.
 *
 * The same rule `ApiTokenRow` states, and it bites harder here, because this value is not a
 * digest. It is the live HMAC key, so a server component that hands the whole row to a client
 * component has serialised it into the RSC payload and published it to anyone who can read
 * that tab's source. The type is what makes that impossible to forget.
 */
export type WebhookListRow = Omit<WebhookRow, 'secret'>

/**
 * What the Add dialog collects.
 *
 * Here rather than beside the Server Action that consumes it, because a `'use server'` module
 * may only export async functions: a type exported from one is either stripped or rejected
 * depending on which side of the boundary reads it, and this one is read from a client
 * component.
 */
export type WebhookFormInput = {
  readonly url: string
  readonly name: string
  /** Plain strings, validated against `WEBHOOK_EVENT_TYPES` in the action. */
  readonly events: readonly string[]
  readonly enabled: boolean
}

/**
 * One queued POST, as WebhookDeliveries stores it and before its subscription is joined on.
 *
 * Distinct from `WebhookDeliveryRow` in `@/features/webhooks/deliver`, which is this plus the
 * `url` and `secret` the drain needs to actually send. The split is the join: the delivery
 * table holds a link, not a copy of the endpoint, so a secret rotated between enqueue and
 * retry signs the retry with the key the receiver is verifying with today.
 */
export type WebhookDeliveryRecord = {
  readonly id: string
  /**
   * Absent once the subscription is deleted: Airtable clears the link cell rather than
   * leaving a dangling id behind. A row in that state is an ORPHAN, and the only thing
   * that happens to it is retirement to `dead` (`partitionDueWebhookDeliveries`).
   */
  readonly webhookId: string | undefined
  readonly eventId: string
  readonly webhookEvent: WebhookEventType
  /** Rides as `X-Bodo-Delivery`, and the key the enqueue upsert merges on. */
  readonly idempotencyKey: string
  /** The EXACT bytes to POST, snapshotted at enqueue. Never rebuilt: see dispatch.ts. */
  readonly body: string
  readonly sendAt: string
  readonly status: OutboxStatus
  readonly attempts: number
  /** Records who claimed the row. Never the grant: that is `claimOnce` in `@/utils/cf`. */
  readonly leaseHolder: string | undefined
  readonly leaseExpiresAt: string | undefined
}
