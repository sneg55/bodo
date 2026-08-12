// One failure mode, from the mapper to the partition: a delivery whose subscription was
// deleted.
//
// This shipped broken and stalled the live queue, so the tests are written against what
// Airtable ACTUALLY leaves behind rather than what the code assumed. Deleting a record clears
// the link cell on every row that pointed at it, so an orphaned delivery holds NOTHING in
// `webhook`, not a dangling id. `mapWebhookDelivery` read that cell as a required link and
// threw E_DATA_002 while mapping the table, which is upstream of every classification, so one
// deleted endpoint took down the whole sweep and every delivery in the base stopped moving
// permanently. Observed on the deployed Worker as `[cron] /api/cron/webhooks returned 500` on
// record recEhywD7WhHyBkqX, 2026-08-11.
//
// The existing starvation test in webhooks-authorization.test.ts models an orphan as a
// dangling id (`webhookId: 'recGone'`), which is why a green suite did not catch this. That
// test still earns its place, because it covers the limit accounting. This one covers the
// shape.

import { describe, expect, it } from 'vitest'

import { mapWebhookDelivery } from '@/services/airtable/mapping-webhooks'
import { partitionDueWebhookDeliveries } from '@/services/airtable/webhook-queue'
import type { WebhookDeliveryRecord } from '@/types/webhook'

const EVENT = 'recE1'
const NOW = '2026-08-11T10:00:00.000Z'

/** Every field of a queued delivery EXCEPT the `webhook` link, which the caller adds or not. */
const DELIVERY_FIELDS = {
  idempotencyKey: 'submission.created:recS1:recWh1',
  event: [EVENT],
  webhookEvent: 'submission.created',
  payloadJson: '{"id":"x"}',
  sendAt: NOW,
  status: 'queued',
  attempts: 0,
}

function record(over: Partial<WebhookDeliveryRecord>): WebhookDeliveryRecord {
  return {
    id: 'recD',
    webhookId: 'recWh1',
    eventId: EVENT,
    webhookEvent: 'submission.created',
    idempotencyKey: 'k',
    body: '{}',
    sendAt: NOW,
    status: 'queued',
    attempts: 0,
    leaseHolder: undefined,
    leaseExpiresAt: undefined,
    ...over,
  }
}

describe('mapWebhookDelivery, on a row whose subscription is gone', () => {
  it('maps the empty link to undefined instead of throwing', () => {
    const row = mapWebhookDelivery({ id: 'recOrphan', fields: DELIVERY_FIELDS })

    expect(row.webhookId).toBeUndefined()
    // The rest still maps, because retirement needs the id and the status columns.
    expect(row.id).toBe('recOrphan')
    expect(row.status).toBe('queued')
  })

  it('still maps a live row the same way it always did', () => {
    const row = mapWebhookDelivery({
      id: 'recD1',
      fields: { ...DELIVERY_FIELDS, webhook: ['recWh1'] },
    })

    expect(row.webhookId).toBe('recWh1')
  })
})

describe('partitionDueWebhookDeliveries, on a cleared link', () => {
  it('treats a row with no subscription id as an orphan to retire', () => {
    const due = [record({ id: 'orphan', webhookId: undefined }), record({ id: 'live' })]

    const { deliverable, orphaned } = partitionDueWebhookDeliveries(
      due,
      (webhookId) => (webhookId === 'recWh1' ? { url: 'https://example.com/hooks' } : undefined),
      5,
    )

    expect(orphaned.map((row) => row.id)).toEqual(['orphan'])
    // And the live row behind it is still sent, which is the whole point of retiring rather
    // than throwing: one dead endpoint must not cost anybody else their delivery.
    expect(deliverable.map((entry) => entry.row.id)).toEqual(['live'])
  })
})
