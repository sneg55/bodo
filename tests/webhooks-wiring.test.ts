// The wiring around the pure webhook modules: the mappers, the due-list policy, the enqueue's
// key discipline, and which reads are cached.
// `dispatch.ts` and `deliver.ts` are covered on their own terms, so nothing here re-tests
// signing or the retry classifier. What is left is the seam between them and Airtable, where
// every assertion below is one that fails SILENTLY in production:
//   - A stored event type the code no longer knows must be dropped, not thrown on, or the day
//     the vocabulary changes the settings page 500s for the organizer who has to fix it.
//   - Two subscriptions to one event type must produce two deliveries: Airtable merges an
//     upsert on `idempotencyKey`, so a key omitting the subscription id tells only one.
//   - The bytes stored are the bytes signed, and a Discord URL gets Discord's shape.
//   - The delivery reads must be UNCACHED: a cached due-list hands a second sweep rows the
//     first has already sent, and nothing about the response would look wrong.
// Starvation and the action rules: tests/webhooks-authorization.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { signWebhookBody, type WebhookSubscription } from '@/features/webhooks/dispatch'
import { webhookDeliveryDrafts, webhookDeliveryKey } from '@/features/webhooks/enqueue'
import { mapWebhook, mapWebhookDelivery } from '@/services/airtable/mapping-webhooks'
import { REVALIDATE } from '@/services/airtable/read-cache'
import { eventWebhooksTag } from '@/services/airtable/tags'
import { dueWebhookDeliveries } from '@/services/airtable/webhook-queue'
import type { WebhookDeliveryRecord } from '@/types/webhook'

const EVENT = 'recE1'
const NOW = '2026-08-11T10:00:00.000Z'

describe('mapWebhook', () => {
  const record = (fields: Record<string, unknown>) => ({
    id: 'recWh1',
    fields: {
      name: 'Program Discord',
      event: [EVENT],
      url: 'https://discord.com/api/webhooks/1/tok',
      secret: 'bodo_secret',
      subscribedEventsJson: JSON.stringify(['submission.created']),
      enabled: true,
      ...fields,
    },
  })

  it('reads the subscription the dispatcher filters on, under one event-scoped tag', () => {
    expect(eventWebhooksTag(EVENT)).toBe('event:recE1:webhooks')
    expect(mapWebhook(record({}))).toMatchObject({
      id: 'recWh1',
      eventId: EVENT,
      name: 'Program Discord',
      secret: 'bodo_secret',
      events: ['submission.created'],
      enabled: true,
    })
  })

  it('drops an event type the code no longer knows and keeps the rest', () => {
    // Why it validates one entry at a time rather than with `z.enum`: retiring a type is a
    // deploy, and it must not take every subscription that still names it offline.
    const stored = ['submission.created', 'submission.retweeted', 'session.published']
    expect(mapWebhook(record({ subscribedEventsJson: JSON.stringify(stored) })).events).toEqual([
      'submission.created',
      'session.published',
    ])
  })

  it('reads a blank list as no subscriptions and an absent checkbox as muted', () => {
    // Both are what a row typed into Airtable by hand looks like, and neither may POST or
    // throw: an unwritten enabled flag defaulting to true is a surprise send.
    expect(mapWebhook(record({ subscribedEventsJson: '' })).events).toEqual([])
    const { enabled: _enabled, ...fields } = record({}).fields
    expect(mapWebhook({ id: 'recWh1', fields }).enabled).toBe(false)
  })
})

describe('mapWebhookDelivery', () => {
  it('carries the snapshotted bytes and the claim columns', () => {
    const row = mapWebhookDelivery({
      id: 'recD1',
      fields: {
        idempotencyKey: 'submission.created:recS1:recWh1',
        webhook: ['recWh1'],
        event: [EVENT],
        webhookEvent: 'submission.created',
        payloadJson: '{"id":"x"}',
        sendAt: NOW,
        status: 'failed',
        attempts: 2,
        leaseHolder: 'sweep-1',
        leaseExpiresAt: '2026-08-11T10:01:00.000Z',
      },
    })

    expect(row).toEqual({
      id: 'recD1',
      webhookId: 'recWh1',
      eventId: EVENT,
      webhookEvent: 'submission.created',
      idempotencyKey: 'submission.created:recS1:recWh1',
      body: '{"id":"x"}',
      sendAt: NOW,
      status: 'failed',
      attempts: 2,
      leaseHolder: 'sweep-1',
      leaseExpiresAt: '2026-08-11T10:01:00.000Z',
    })
  })
})

describe('dueWebhookDeliveries', () => {
  const row = (over: Partial<WebhookDeliveryRecord>): WebhookDeliveryRecord => ({
    id: 'recD',
    webhookId: 'recWh1',
    eventId: EVENT,
    webhookEvent: 'submission.created',
    idempotencyKey: 'k',
    body: '{}',
    sendAt: '2026-08-11T09:00:00.000Z',
    status: 'queued',
    attempts: 0,
    leaseHolder: undefined,
    leaseExpiresAt: undefined,
    ...over,
  })

  it('retries a failed row, which is what makes the attempt cap reachable at all', () => {
    expect(dueWebhookDeliveries([row({ status: 'failed' })], NOW, 25)).toHaveLength(1)
  })

  it('recovers a sending row whose lease lapsed and leaves a live one alone', () => {
    const rows = [
      row({ id: 'lapsed', status: 'sending', leaseExpiresAt: NOW }),
      row({ id: 'held', status: 'sending', leaseExpiresAt: '2026-08-11T10:05:00.000Z' }),
    ]
    expect(dueWebhookDeliveries(rows, NOW, 25).map((entry) => entry.id)).toEqual(['lapsed'])
  })

  it('never re-sends a sent row or knocks again on a dead one', () => {
    const rows = [row({ id: 'a', status: 'sent' }), row({ id: 'b', status: 'dead' })]
    expect(dueWebhookDeliveries(rows, NOW, 25)).toEqual([])
  })

  it('holds a row back until its sendAt, then drains oldest first within the limit', () => {
    const rows = [
      row({ id: 'later', sendAt: '2026-08-11T09:30:00.000Z' }),
      row({ id: 'future', sendAt: '2026-08-11T23:00:00.000Z' }),
      row({ id: 'oldest', sendAt: '2026-08-11T08:00:00.000Z' }),
    ]
    expect(dueWebhookDeliveries(rows, NOW, 2).map((entry) => entry.id)).toEqual(['oldest', 'later'])
  })
})

describe('webhookDeliveryDrafts', () => {
  const subscription = (over: Partial<WebhookSubscription>): WebhookSubscription => ({
    id: 'recWh1',
    eventId: EVENT,
    url: 'https://example.com/hooks/bodo',
    secret: 'secret-one',
    events: ['submission.created'],
    enabled: true,
    ...over,
  })

  const occurrence = {
    eventId: EVENT,
    key: 'submission.created:recS1',
    payload: {
      type: 'submission.created' as const,
      submission: { id: 'recS1', code: 'AIE-001', title: 'Agents at scale' },
    },
  }

  it('gives two subscribers distinct keys, which is what stops the upsert merging them', async () => {
    const drafts = await webhookDeliveryDrafts(
      [subscription({}), subscription({ id: 'recWh2', secret: 'secret-two' })],
      occurrence,
      NOW,
    )

    expect(drafts.map((draft) => draft.idempotencyKey)).toEqual([
      'submission.created:recS1:recWh1',
      'submission.created:recS1:recWh2',
    ])
    expect(webhookDeliveryKey(occurrence.key, 'recWh2')).toBe('submission.created:recS1:recWh2')
  })

  it('writes nothing for a muted endpoint or one that did not ask for this type', async () => {
    const drafts = await webhookDeliveryDrafts(
      [
        subscription({ id: 'muted', enabled: false }),
        subscription({ id: 'uninterested', events: ['task.completed'] }),
      ],
      occurrence,
      NOW,
    )

    expect(drafts).toEqual([])
  })

  it('stores bytes that re-sign cleanly, keyed on the same id the header carries', async () => {
    const draft = (await webhookDeliveryDrafts([subscription({})], occurrence, NOW)).at(0)

    expect(JSON.parse(draft?.body ?? '{}')).toMatchObject({
      // The per-endpoint key, so `X-Bodo-Delivery` and the body agree on what one delivery is.
      id: 'submission.created:recS1:recWh1',
      type: 'submission.created',
      eventId: EVENT,
    })
    // What the drain recomputes at send time, off the row it reads back.
    await expect(signWebhookBody('secret-one', draft?.body ?? '')).resolves.toMatch(
      /^sha256=[0-9a-f]{64}$/,
    )
    expect(draft?.sendAt).toBe(NOW)
  })

  it('shapes a Discord URL as a Discord message rather than the generic envelope', async () => {
    const draft = (
      await webhookDeliveryDrafts(
        [subscription({ url: 'https://discord.com/api/webhooks/1/tok' })],
        occurrence,
        NOW,
      )
    ).at(0)

    // Discord answers 400 `Cannot send an empty message` to the generic envelope, so this is
    // the difference between a channel post and an error an organizer reads as "webhooks are
    // broken". Asserted on the STORED bytes, because those are what get POSTed.
    expect(JSON.parse(draft?.body ?? '{}')).toEqual({
      content: 'New submission: **Agents at scale** (AIE-001)',
    })
  })
})

// ── Which reads are cached, through a stubbed global fetch ────────────────────

const ORIGINAL_ENV = { ...process.env }

/** Credentials matter: with none, `getSource()` serves fixtures and issues no request at all. */
async function loadReads(): Promise<{
  calls: RequestInit[]
  reads: typeof import('@/services/airtable/reads-webhooks')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: RequestInit[] = []
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    calls.push(init ?? {})
    return Promise.resolve(
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })

  return { calls, reads: await import('@/services/airtable/reads-webhooks') }
}

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ORIGINAL_ENV }
})

describe('the webhook reads declare their caching', () => {
  it('caches the settings list under the one tag every write expires', async () => {
    const { reads, calls } = await loadReads()

    await reads.listWebhooks(EVENT)

    expect(calls.at(0)?.next).toEqual({
      revalidate: REVALIDATE.edited,
      tags: [eventWebhooksTag(EVENT)],
    })
  })

  it('leaves the enqueue path uncached, because it decides who gets a row written', async () => {
    const { reads, calls } = await loadReads()

    await reads.listWebhooksForDispatch(EVENT)

    expect(calls.at(0)?.cache).toBe('no-store')
    expect(calls.at(0)?.next).toBeUndefined()
  })

  it('leaves the drain due-list uncached, because a cached one re-sends what has gone', async () => {
    const { reads, calls } = await loadReads()

    await reads.listDueWebhookDeliveries(NOW, 25)

    expect(calls.at(0)?.cache).toBe('no-store')
    expect(calls.at(0)?.next).toBeUndefined()
  })

  it('leaves the idempotency lookup uncached, because a stale miss writes a second row', async () => {
    const { reads, calls } = await loadReads()

    await reads.existingWebhookDeliveryKeys(['k1'])

    expect(calls.at(0)?.cache).toBe('no-store')
    expect(calls.at(0)?.next).toBeUndefined()
  })
})
