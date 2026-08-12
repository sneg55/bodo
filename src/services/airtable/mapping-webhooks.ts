// Mappers for Webhooks and WebhookDeliveries (design section 5).
//
// One decision here is not the DAL's usual posture and is worth stating rather than reading
// as an oversight. Everywhere else a stored blob that does not match its schema THROWS naming
// the record (`jsonBlob`, mapping-saved-views.ts), because a blob is written by one code path
// and a mismatch means the schema and the writer have diverged. `subscribedEventsJson` is
// different in one specific way: its contents are a PUBLISHED VOCABULARY, and the operation
// that invalidates a stored entry is renaming or retiring an event type in
// `WEBHOOK_EVENT_TYPES`. That is a deploy, not a bug, and on the deploy that does it every
// subscription still naming the old type would stop being readable at once, taking the
// settings page down for the organizer who has to go and fix them. So an unknown entry is
// DROPPED and the rest of the row survives: the subscription keeps working for the types it
// still names, and the one it lost is visibly missing from its row on the settings screen.
//
// Everything else is strict. In particular `url` and `secret` are both required: a
// subscription missing either cannot sign or send anything, so reading one as an empty string
// would produce a valid HMAC under an empty key and POST it into the void, which is a silent
// failure where a loud one costs nothing.

import { z } from 'zod'

import { OUTBOX_STATUSES } from '@/constants/status'
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/features/webhooks/dispatch'
import {
  type AirtableRecord,
  checkbox,
  choiceOr,
  jsonBlob,
  numberOr,
  optionalLink,
  optionalText,
  type RecordView,
  requiredChoice,
  requiredLink,
  text,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import type { WebhookDeliveryRecord, WebhookRow } from '@/types/webhook'

/**
 * The stored shape, which is an array of arbitrary strings.
 *
 * Validated against `WEBHOOK_EVENT_TYPES` one entry at a time below rather than with
 * `z.enum`, because a whole-array enum fails the row on its first unknown entry, which is
 * exactly the take-the-page-down behaviour the file header rejects.
 */
const storedEventsSchema = z.array(z.string())

const isWebhookEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_EVENT_TYPES.some((type) => type === value)

/** The event types this subscription wants, with anything the code no longer knows dropped. */
export function subscribedEvents(source: RecordView): readonly WebhookEventType[] {
  // A blank column is an empty set rather than an error: a row typed into Airtable directly
  // has it empty, and "subscribed to nothing" is a legible state (`selectSubscriptions`
  // matches it against no event) where a thrown error is not.
  return jsonBlob(source, COL.subscribedEventsJson, storedEventsSchema, []).filter(
    isWebhookEventType,
  )
}

export function mapWebhook(record: AirtableRecord): WebhookRow {
  const source = view(TABLES.webhooks, record)
  return {
    id: source.id,
    eventId: requiredLink(source, COL.event),
    // A fallback rather than a throw, and the only soft field here: the name is for the
    // organizer's own benefit, so a row created in Airtable with a blank primary field is
    // still a working endpoint and must not take the list down to say so.
    name: optionalText(source, COL.name) ?? 'Untitled endpoint',
    url: text(source, COL.url),
    secret: text(source, COL.secret),
    events: subscribedEvents(source),
    // An unchecked Airtable checkbox is absent, and absent means muted. That direction is
    // deliberate: a row whose enabled flag never got written should not start POSTing.
    enabled: checkbox(source, COL.enabled),
    lastStatus: optionalText(source, COL.lastStatus),
    lastAttemptAt: optionalText(source, COL.lastAttemptAt),
  }
}

export function mapWebhookDelivery(record: AirtableRecord): WebhookDeliveryRecord {
  const source = view(TABLES.webhookDeliveries, record)
  return {
    id: source.id,
    // OPTIONAL, and this is the one field on the row that must not throw when it is empty.
    // Deleting a subscription is a supported action (`deleteWebhook`), and Airtable clears the
    // link cell on every row that pointed at the deleted record, so an orphaned delivery does
    // not hold a dangling id: it holds NOTHING. Reading it as required threw E_DATA_002 while
    // mapping the table, before `partitionDueWebhookDeliveries` could classify the row, which
    // took down the whole sweep rather than the one row: one deleted endpoint stalled every
    // delivery in the base, on every sweep, permanently. Observed on the deployed Worker as
    // `/api/cron/webhooks returned 500` on record recEhywD7WhHyBkqX. Mapping it to `undefined`
    // is what lets the row reach the partition, be recognised as orphaned, and get retired to
    // `dead` by the path that was already written for it.
    webhookId: optionalLink(source, COL.webhook),
    eventId: requiredLink(source, COL.event),
    // Required and NOT defaulted, unlike `status` below: the event type picks the payload
    // shape and rides in `X-Bodo-Event`, so guessing one would sign bytes claiming to be
    // something they are not.
    webhookEvent: requiredChoice(source, COL.webhookEvent, WEBHOOK_EVENT_TYPES),
    idempotencyKey: text(source, COL.idempotencyKey),
    // Required: these are the exact bytes the signature covers. A row with no body has
    // nothing to send, and an empty string would be POSTed and signed as if it did.
    body: text(source, COL.payloadJson),
    // Required for the same reason `OutboxRow.sendAt` is: a row with no send time has no
    // place in a due list, and reading a blank one as "now" fires a half-written row.
    sendAt: text(source, COL.sendAt),
    status: choiceOr(source, COL.status, OUTBOX_STATUSES, 'queued'),
    attempts: numberOr(source, COL.attempts, 0),
    leaseHolder: optionalText(source, COL.leaseHolder),
    leaseExpiresAt: optionalText(source, COL.leaseExpiresAt),
  }
}
