// The two tables outbound webhooks add: Webhooks and WebhookDeliveries.
//
// A SIBLING delivery table rather than six more columns on EmailOutbox, and the reason is
// blast radius rather than tidiness. `OutboxRow` carries R3's mail, which already works and
// whose idempotency guarantee is that `idempotencyKey` is the PRIMARY field, the only key
// Airtable's upsert can merge on. Widening that row means every mail read, every mapper and
// the drain's fencing now have a second kind of row to be correct about, for a feature that
// shares nothing with mail except a retry policy. Duplicating the lease columns is the
// cheaper mistake: the worst it costs is two places to change if leasing ever changes.
//
// The lease columns are spelled with the same `COL` entries EmailOutbox uses, deliberately.
// `status`, `attempts`, `leaseHolder` and `leaseExpiresAt` mean here exactly what they mean
// there, so the two drains can be read side by side and a claim looks the same on both.
//
// Each declaration leads with a text field because Airtable forbids a link, select, or
// checkbox as the primary field.

import { OUTBOX_STATUSES } from '@/constants/status'
// The one vocabulary, imported rather than re-listed: `requiredChoice` in records.ts throws
// on a value outside a select's choices, so a second copy of these four strings is a row the
// DAL refuses to read the day one of them is renamed.
import { WEBHOOK_EVENT_TYPES } from '@/features/webhooks/dispatch'
import {
  checkboxField,
  dateTimeField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
  urlField,
} from '@/migrations/schema-types'
import { COL_WEBHOOKS } from '@/services/airtable/columns-webhooks'
import { COL, TABLES } from '@/services/airtable/tables'

/**
 * One endpoint an organizer has subscribed to some of the four event types.
 *
 * Leads with `name` because the primary field cannot be a link or a checkbox and the other
 * candidate, `url`, is the field an organizer is most likely to paste-and-replace: a primary
 * field is what every linked-record chip in the base renders, so a row that reads
 * `https://discord.com/api/webhooks/123/aVeryLongToken` in the Deliveries table tells nobody
 * which integration it is, and it puts the SECRET half of a Discord URL on every screen that
 * shows the link.
 *
 * `lastStatus` and `lastAttemptAt` are denormalised from the newest delivery on purpose. The
 * question an organizer asks on the settings screen is "is my endpoint working", and
 * answering it from the Deliveries table means a sort and a read per row.
 */
const webhooks: TableSpec = {
  name: TABLES.webhooks,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    urlField(COL_WEBHOOKS.url),
    text(COL_WEBHOOKS.secret),
    longText(COL_WEBHOOKS.subscribedEventsJson),
    checkboxField(COL.enabled),
    text(COL_WEBHOOKS.lastStatus),
    dateTimeField(COL_WEBHOOKS.lastAttemptAt),
  ],
}

/**
 * One POST that has to happen, with the exact bytes it will send.
 *
 * `payloadJson` holds the SERIALIZED body rather than the event that produced it, and that
 * is the whole reason this table exists rather than a queue of event ids. The signature is
 * computed over the bytes on the wire, so a delivery that re-derived its body at send time
 * would sign whatever the code shape happened to be that day: a reordered key or a field
 * added to the payload builder between enqueue and retry produces a body the receiver's
 * stored signature no longer matches. Snapshotting is the same call `OutboxPayload` makes
 * for mail, for the same reason.
 *
 * `idempotencyKey` leads, exactly as it does on EmailOutbox, and for the same mechanical
 * reason: it is the only key `client.upsertRecords` can merge on, so a trigger that fires
 * twice for one state change enqueues one row rather than two POSTs.
 */
const webhookDeliveries: TableSpec = {
  name: TABLES.webhookDeliveries,
  fields: [
    text(COL.idempotencyKey),
    link(COL_WEBHOOKS.webhook, TABLES.webhooks),
    link(COL.event, TABLES.events),
    select(COL_WEBHOOKS.webhookEvent, WEBHOOK_EVENT_TYPES),
    longText(COL.payloadJson),
    dateTimeField(COL.sendAt),
    select(COL.status, OUTBOX_STATUSES),
    numberField(COL.attempts),
    // These two RECORD a claim, they do not grant one. Claiming is claimOnce() in
    // src/utils/cf.ts, backed by the ClaimGuard Durable Object, because Airtable has no
    // compare-and-swap and two senders here would both believe they won. Same note as
    // EmailOutbox, same mechanism, and the drain in ./deliver.ts fences against these.
    text(COL.leaseHolder),
    dateTimeField(COL.leaseExpiresAt),
    // The receiver's answer, kept per delivery as well as denormalised onto the Webhooks
    // row: the subscription only remembers the newest, and "it worked at 10:02 and has 500ed
    // every attempt since" is a per-row fact.
    text(COL_WEBHOOKS.lastStatus),
    text(COL.lastError),
    dateTimeField(COL.sentAt),
  ],
}

export const WEBHOOK_TABLES: readonly TableSpec[] = [webhooks, webhookDeliveries]
