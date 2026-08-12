// Reads for Webhooks and WebhookDeliveries, and the whole caching decision for the feature.
//
// **Exactly one read here is cached: `listWebhooks`, the settings screen's list.** It carries
// `eventWebhooksTag` and the edited window, and every write in mutations-webhooks.ts expires
// that tag. Everything else in this file is deliberately UNCACHED, and each one is a
// different way for a cached answer to send somebody's webhook twice:
//
//   - `listDueWebhookDeliveries` is the drain's due-list. This is `listDueOutbox`'s rule
//     applied to a second queue: two overlapping cron invocations served the same cached page
//     would both be handed rows the first has already POSTed. `claimOnce` would stop the
//     double POST, so the visible symptom is milder than for mail, but a cached due-list also
//     keeps handing back rows that are already `sent`, which is a sweep spent claiming
//     nothing.
//   - `listWebhooksForDispatch` is the enqueue path's read of the subscriptions. It decides
//     which endpoints get a row written for an event that just happened, so a cached answer
//     enqueues a POST to an endpoint the organizer deleted a minute ago, or misses one they
//     just added. `listWebhooks` reads the same table for the settings screen and IS cached,
//     and the contrast is the point rather than an inconsistency: one renders, one decides.
//   - `webhookDeliveryLeaseHolder` is the fence. A cached holder fences against a lease the
//     row has since handed on, which is precisely the mistake the read exists to catch.
//   - `existingWebhookDeliveryKeys` is the enqueue idempotency check. A cached "not present"
//     answer writes a second row for a state change that already has one.
//   - `getWebhookForAuthz` decides whether a mutation is ALLOWED. A cached answer authorizes
//     against an ownership that may since have moved, which is the one thing a cache must
//     never be trusted for.
//
// None of them pass a `ReadCache`, and `cacheInit` turns that into an explicit `no-store`
// rather than leaving it to a default, because uncached here is a guarantee rather than a
// preference. Scoping to one event is done in code and not with a `filterByFormula`, for the
// reason formula.ts gives: `event` is a link field and Airtable cannot filter one usefully.

import type { WebhookDeliveryRow } from '@/features/webhooks/deliver'
import { chunk, getClient } from '@/services/airtable/client'
import { anyFieldEquals } from '@/services/airtable/formula'
import { mapWebhook, mapWebhookDelivery } from '@/services/airtable/mapping-webhooks'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { optionalText, view } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import { eventWebhooksTag } from '@/services/airtable/tags'
import {
  dueWebhookDeliveries,
  partitionDueWebhookDeliveries,
} from '@/services/airtable/webhook-queue'
import type { WebhookDeliveryRecord, WebhookRow } from '@/types/webhook'

/** Keys per `filterByFormula`. The formula travels in the query string, which has a ceiling. */
const KEY_LOOKUP_CHUNK = 25

async function readWebhooks(eventId: string, cached: boolean): Promise<readonly WebhookRow[]> {
  const records = await getClient().listAll(
    TABLES.webhooks,
    cached ? { tags: [eventWebhooksTag(eventId)], revalidate: REVALIDATE.edited } : undefined,
  )
  return records.map(mapWebhook).filter((row) => row.eventId === eventId)
}

/**
 * The event's subscriptions for the settings screen. CACHED.
 *
 * Safe to cache because nothing decides anything from it: it is rendered, and every write
 * that changes what it shows expires `eventWebhooksTag`, including the delivery outcomes that
 * stamp `lastStatus` onto a row.
 */
export async function listWebhooks(eventId: string): Promise<readonly WebhookRow[]> {
  return await readWebhooks(eventId, true)
}

/**
 * The event's subscriptions for the enqueue path. UNCACHED, see the file header.
 *
 * A separate function rather than a flag on `listWebhooks`, so that the caching decision is
 * made by the name at the call site instead of by a boolean somebody can pass wrong.
 */
export async function listWebhooksForDispatch(eventId: string): Promise<readonly WebhookRow[]> {
  return await readWebhooks(eventId, false)
}

/**
 * One subscription by record id, for an OWNERSHIP CHECK. UNCACHED, see the file header.
 *
 * The name says what it is for, because that is the whole reason it exists: `setWebhookEnabled`
 * and `deleteWebhook` address the row by record id, so an action holding an event id and a
 * webhook id has to be able to ask which event the webhook is actually on before it writes.
 * A direct record fetch rather than filtering `listWebhooks`, so a caller cannot accidentally
 * authorize off a cached list.
 *
 * A missing id answers `undefined` rather than throwing. Airtable returns 404 for a record
 * that is not there and the client turns that into an `AppError`, but the caller's refusal has
 * to read the same whether the row is gone or belongs to somebody else, so the distinction is
 * swallowed here rather than left for the caller to remember.
 */
export async function getWebhookForAuthz(webhookId: string): Promise<WebhookRow | undefined> {
  try {
    return mapWebhook(await getClient().getRecord(TABLES.webhooks, webhookId))
  } catch {
    return undefined
  }
}

/**
 * Retire deliveries whose subscription has been deleted, by putting them in a TERMINAL state.
 *
 * This used to be a `console.warn` and a `return []`, and that was the whole bug: a dropped
 * row keeps its `queued` status, so it is due again on the next sweep and on every sweep after
 * that, forever. `dead` is the correct terminal state and it is already the one the retry cap
 * uses, so `dueWebhookDeliveries` stops selecting these rows the moment the write lands and
 * the drain never sees them again. `lastError` says why, in the column an organizer would look
 * at, so the retirement is legible rather than a row that silently stopped moving.
 *
 * **A write in a reads file, deliberately, and the reason is an import cycle.**
 * `mutations-webhooks.ts` already imports `existingWebhookDeliveryKeys` from here, so putting
 * this next to the other delivery writes would make the two modules import each other and
 * `import/no-cycle` (eslint.config.mjs) rejects that as an error. The alternative was for
 * `listDueWebhookDeliveries` to report orphans and let the cron route retire them, which puts
 * a correctness rule in a route handler where the next queue's route can forget it. It expires
 * NO tag, on the same reasoning `enqueueWebhookDeliveries` states: this touches only
 * WebhookDeliveries, every read of which is uncached, so there is no cache entry to affect.
 */
async function retireOrphanedWebhookDeliveries(
  orphaned: readonly WebhookDeliveryRecord[],
): Promise<void> {
  if (orphaned.length === 0) return
  const ids = orphaned.map((row) => row.id)
  console.warn(`[cron] retiring webhook deliveries whose subscription is gone: ${ids.join(', ')}`)

  await getClient().updateRecords(
    TABLES.webhookDeliveries,
    orphaned.map((row) => ({
      id: row.id,
      fields: {
        [COL.status]: 'dead',
        // What an organizer reads on a row that outlived its endpoint.
        [COL.lastError]: 'the subscription this delivery belonged to was deleted',
        // Released, because nothing is going to send this row and a lingering holder makes
        // the fence in the drain read as though somebody still is.
        [COL.leaseHolder]: '',
      },
    })),
  )
}

/**
 * The due rows with their endpoint joined on, ready for `drainWebhookDeliveries`. UNCACHED.
 *
 * The join is a second whole-table read rather than a lookup per row, because the delivery
 * table holds a LINK and Airtable will not return a linked row's fields: one list read of
 * every subscription in the base costs one request no matter how many rows are due, where a
 * per-row `getRecord` would cost one each and spend the sweep backing off the rate limiter.
 *
 * Reading the endpoint at SEND time rather than copying it onto the delivery row is what
 * makes a rotated secret work: a retry three hours later signs with the key the receiver is
 * verifying with today. The BODY is still the snapshot taken at enqueue (dispatch.ts rule 2),
 * so the two halves of the contract stay on the sides they belong to.
 *
 * The due list is computed UNLIMITED and the limit is applied after the join, by
 * `partitionDueWebhookDeliveries`; a row whose subscription is gone is retired rather than
 * dropped. Both are there for the same stall, which that function's comment describes. A
 * DISABLED subscription still gets its already-queued rows delivered, deliberately: muting an
 * endpoint says "stop telling me about NEW things", not "throw away what you already
 * accepted".
 */
export async function listDueWebhookDeliveries(
  nowIso: string,
  limit: number,
): Promise<readonly WebhookDeliveryRow[]> {
  const client = getClient()
  const records = await client.listAll(TABLES.webhookDeliveries)
  const due = dueWebhookDeliveries(
    records.map(mapWebhookDelivery),
    nowIso,
    Number.POSITIVE_INFINITY,
  )
  if (due.length === 0) return []

  const endpoints = new Map(
    (await client.listAll(TABLES.webhooks)).map(mapWebhook).map((row) => [row.id, row]),
  )
  const { deliverable, orphaned } = partitionDueWebhookDeliveries(
    due,
    (webhookId) => (webhookId === undefined ? undefined : endpoints.get(webhookId)),
    limit,
  )

  await retireOrphanedWebhookDeliveries(orphaned)

  return deliverable.map(({ row, endpoint }) => ({
    id: row.id,
    // From the ENDPOINT, not the row: a deliverable row is by definition one whose link
    // resolved, so this is the same id with the `undefined` case already ruled out.
    webhookId: endpoint.id,
    eventId: row.eventId,
    webhookEvent: row.webhookEvent,
    url: endpoint.url,
    secret: endpoint.secret,
    body: row.body,
    attempts: row.attempts,
    deliveryKey: row.idempotencyKey,
  }))
}

/** The holder recorded on one delivery row right now. UNCACHED: it is the fence. */
export async function webhookDeliveryLeaseHolder(rowId: string): Promise<string | undefined> {
  const record = await getClient().getRecord(TABLES.webhookDeliveries, rowId)
  return mapWebhookDelivery(record).leaseHolder
}

/**
 * Which of these `idempotencyKey` values the delivery table already holds. UNCACHED.
 *
 * A formula is usable here, and only here, because `idempotencyKey` is a real text column
 * rather than a link. Asking for the one field keeps each page small.
 */
export async function existingWebhookDeliveryKeys(
  keys: readonly string[],
): Promise<ReadonlySet<string>> {
  const client = getClient()
  const found = new Set<string>()

  for (const batch of chunk(keys, KEY_LOOKUP_CHUNK)) {
    const records = await client.listAll(TABLES.webhookDeliveries, {
      filterByFormula: anyFieldEquals(COL.idempotencyKey, [...batch]),
      fields: [COL.idempotencyKey],
    })
    for (const record of records) {
      // Through `view`, never `record.fields[...]`: a field is only ever looked up by name
      // through a Map here, so a column literally called `__proto__` cannot read off the
      // prototype chain (records.ts).
      const value = optionalText(view(TABLES.webhookDeliveries, record), COL.idempotencyKey)
      if (value !== undefined) found.add(value)
    }
  }

  return found
}
