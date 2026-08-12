// The three webhook rules that fail SILENTLY. Split out of tests/webhooks-wiring.test.ts only
// because that file is at the 300 line ceiling the file-size hook enforces.
//
//   1. A delivery whose subscription was deleted must reach a TERMINAL state. Dropped and left
//      `queued` it is due again on every later sweep, so once the oldest `limit` due rows are
//      all orphans, each sweep selects exactly those, discards all of them, and never reaches
//      a deliverable row. Nothing errors, the cron keeps answering 200, deliveries just stop.
//   2. An action that names a webhook must confirm the webhook is on the event it authorized.
//      `requireEventRole` authorizes the EVENT and the DAL then writes by RECORD ID, so
//      without the second check an admin of event A can mute or delete event B's endpoint,
//      by POST, with the settings screen never rendering.
//   3. The `[eventId]` segment may be a SLUG, which `requireEventRole` resolves internally and
//      does not return, so a caller keeping the value it was handed authorizes correctly and
//      then expires `event:<slug>:webhooks`, a tag no read subscribes to.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { isEventRecordId } from '@/features/events/event-ref'
import { eventWebhooksTag } from '@/services/airtable/tags'
import { partitionDueWebhookDeliveries } from '@/services/airtable/webhook-queue'
import type { WebhookDeliveryRecord, WebhookRow } from '@/types/webhook'

/** Real record-id shape, because `isEventRecordId` is anchored and `recE1` is a slug to it. */
const EVENT_A = 'recEvent000000001'
const EVENT_B = 'recEvent000000002'
const SLUG = 'ai-engineer-worlds-fair'
const NOW = '2026-08-11T10:00:00.000Z'
const ORIGINAL_ENV = { ...process.env }

function delivery(over: Partial<WebhookDeliveryRecord>): WebhookDeliveryRecord {
  return {
    id: 'recD',
    webhookId: 'recWh1',
    eventId: EVENT_A,
    webhookEvent: 'submission.created',
    idempotencyKey: 'k',
    body: '{}',
    sendAt: '2026-08-11T09:00:00.000Z',
    status: 'queued',
    attempts: 0,
    leaseHolder: undefined,
    leaseExpiresAt: undefined,
    ...over,
  }
}

/** Twelve orphans, all older than anything deliverable, so they sort to the front. */
const ORPHANS = Array.from({ length: 12 }, (_, index) => ({
  id: `orphan-${index}`,
  sendAt: `2026-08-11T08:00:${String(index).padStart(2, '0')}.000Z`,
}))

const RETIRED_IDS = ORPHANS.slice(0, 5).map((row) => row.id)

/** The one live endpoint, shared by the Airtable record fixture and the mapped row. */
const ENDPOINT = {
  name: 'Program Discord',
  url: 'https://example.com/hooks/bodo',
  secret: 'secret-one',
  enabled: true,
}

describe('partitionDueWebhookDeliveries', () => {
  it('spends the limit only on rows that can be sent, so orphans cannot crowd out work', () => {
    const due = [
      ...ORPHANS.map((orphan) => delivery({ ...orphan, webhookId: 'recGone' })),
      delivery({ id: 'valid' }),
    ]

    const { deliverable, orphaned } = partitionDueWebhookDeliveries(
      due,
      (webhookId) => (webhookId === 'recWh1' ? { url: 'https://example.com/hooks' } : undefined),
      5,
    )

    // This is the regression. The previous code sliced the due list to the limit BEFORE
    // joining the endpoint, so `valid` sat behind five orphans that were selected and
    // discarded on every single sweep and never once came up.
    expect(deliverable.map((entry) => entry.row.id)).toEqual(['valid'])
    // Capped at the limit too, because each orphan costs a write. That only delays the
    // cleanup: a retired row stops being due, so the backlog shrinks every sweep.
    expect(orphaned.map((row) => row.id)).toEqual(RETIRED_IDS)
  })

  it('reports nothing to retire when every subscription is still there', () => {
    const rows = [delivery({ id: 'a' }), delivery({ id: 'b' })]
    const split = partitionDueWebhookDeliveries(rows, () => ({ url: 'https://x.test' }), 5)
    expect(split.deliverable).toHaveLength(2)
    expect(split.orphaned).toEqual([])
  })
})

// ── The drain's due-list, through a stubbed global fetch ──────────────────────

type StubCall = { url: string; init: RequestInit }
type Patch = { id: string; fields: Record<string, unknown> }
/** Credentials matter: with none, `getSource()` serves fixtures and issues no request at all. */
async function loadReads(respond: (call: StubCall) => unknown): Promise<{
  calls: StubCall[]
  reads: typeof import('@/services/airtable/reads-webhooks')
}> {
  process.env = { ...ORIGINAL_ENV, AIRTABLE_TOKEN: 'patTest', AIRTABLE_BASE_ID: 'appTest' }
  vi.resetModules()

  const calls: StubCall[] = []
  const headers = { 'content-type': 'application/json' }
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const call = { url, init: init ?? {} }
    calls.push(call)
    const body = JSON.stringify(respond(call))
    return Promise.resolve(new Response(body, { status: 200, headers }))
  })

  return { calls, reads: await import('@/services/airtable/reads-webhooks') }
}

const deliveryRecord = (id: string, webhookId: string, sendAt: string) => ({
  id,
  fields: {
    idempotencyKey: id,
    webhook: [webhookId],
    event: [EVENT_A],
    webhookEvent: 'submission.created',
    payloadJson: '{"id":"x"}',
    sendAt,
    status: 'queued',
  },
})

const ENDPOINT_RECORD = {
  id: 'recWh1',
  fields: {
    ...ENDPOINT,
    event: [EVENT_A],
    subscribedEventsJson: JSON.stringify(['submission.created']),
  },
}

describe('listDueWebhookDeliveries', () => {
  it('retires the orphans and still hands the drain the deliverable row behind them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const patched: Patch[] = []
    const deliveries = [
      ...ORPHANS.map((orphan) => deliveryRecord(orphan.id, 'recGone', orphan.sendAt)),
      deliveryRecord('valid', 'recWh1', '2026-08-11T09:00:00.000Z'),
    ]

    const { reads } = await loadReads(({ url, init }) => {
      if (init.method === 'PATCH') {
        patched.push(...(JSON.parse(init.body as string) as { records: Patch[] }).records)
        return { records: [] }
      }
      return { records: url.includes('/WebhookDeliveries') ? deliveries : [ENDPOINT_RECORD] }
    })

    const rows = await reads.listDueWebhookDeliveries(NOW, 5)

    expect(rows.map((row) => row.id)).toEqual(['valid'])
    // Joined at SEND time off the subscription, which is what makes a rotated secret work.
    expect(rows.at(0)?.url).toBe('https://example.com/hooks/bodo')

    // Terminal, so `dueWebhookDeliveries` stops selecting them the moment this write lands.
    expect(patched.map((record) => record.id)).toEqual(RETIRED_IDS)
    expect(patched.every((record) => record.fields.status === 'dead')).toBe(true)
    expect(patched.at(0)?.fields.lastError).toContain('deleted')
    // Visible rather than silent: a sweep that retired rows says so in `wrangler tail`.
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('writes nothing and reads no subscriptions when nothing is due', async () => {
    const { reads, calls } = await loadReads(() => ({ records: [] }))
    expect(await reads.listDueWebhookDeliveries(NOW, 5)).toEqual([])
    expect(calls).toHaveLength(1)
  })
})

// ── The Server Actions ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireEventRole: vi.fn(),
  resolveEventRef: vi.fn(),
  getWebhookForAuthz: vi.fn(),
  createWebhook: vi.fn(),
  setWebhookEnabled: vi.fn(),
  deleteWebhook: vi.fn(),
}))

const WIRING = '@/features/auth/wiring'
const RESOLVE = '@/features/events/resolve-ref'
const READS = '@/services/airtable/reads-webhooks'
const MUTATIONS = '@/services/airtable/mutations-webhooks'
/**
 * `doMock` rather than a hoisted `vi.mock`, because this file also imports the real
 * `reads-webhooks`: statically for the partition, and dynamically under a stubbed fetch for
 * the due-list. A hoisted mock would replace both.
 */
async function loadActions(): Promise<typeof import('@/features/webhooks/actions')> {
  vi.resetModules()
  vi.doMock(WIRING, () => ({ requireEventRole: mocks.requireEventRole }))
  vi.doMock(RESOLVE, () => ({ resolveEventRef: mocks.resolveEventRef }))
  vi.doMock(READS, () => ({ getWebhookForAuthz: mocks.getWebhookForAuthz }))
  vi.doMock(MUTATIONS, () => ({
    createWebhook: mocks.createWebhook,
    setWebhookEnabled: mocks.setWebhookEnabled,
    deleteWebhook: mocks.deleteWebhook,
  }))
  return await import('@/features/webhooks/actions')
}

const subscription = (eventId: string): WebhookRow => ({
  ...ENDPOINT,
  id: 'recWh1',
  eventId,
  events: ['submission.created'],
  lastStatus: undefined,
  lastAttemptAt: undefined,
})

const REFUSED = {
  ok: false,
  errorId: ErrorIds.AUTH_FORBIDDEN_ROLE,
  message: 'that webhook is not on this event',
}

afterEach(() => {
  vi.unstubAllGlobals()
  // Unregistered every time, or the next `loadReads` would import the MOCKED reads module.
  for (const path of [WIRING, RESOLVE, READS, MUTATIONS]) vi.doUnmock(path)
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

describe('the webhook Server Actions', () => {
  beforeEach(() => {
    // Faithful to the real resolver: a record id resolves to itself with no read, a slug is
    // looked up, and a ref no event holds resolves to undefined.
    mocks.resolveEventRef.mockImplementation((ref: string) =>
      Promise.resolve(ref === SLUG ? EVENT_A : isEventRecordId(ref) ? ref : undefined),
    )
  })

  it('refuses another event, and a webhook that is not there, in identical words', async () => {
    const actions = await loadActions()

    mocks.getWebhookForAuthz.mockResolvedValue(subscription(EVENT_B))
    const foreignMute = await actions.setWebhookEnabledAction(EVENT_A, 'recWh1', false)
    const foreignDelete = await actions.deleteWebhookAction(EVENT_A, 'recWh1')

    mocks.getWebhookForAuthz.mockResolvedValue(undefined)
    const absent = await actions.deleteWebhookAction(EVENT_A, 'recNoSuchRecord')

    // The role check PASSED: the caller really is an admin of A. That is the whole point.
    expect(mocks.requireEventRole).toHaveBeenCalledWith(EVENT_A, 'admin')
    expect(mocks.setWebhookEnabled).not.toHaveBeenCalled()
    expect(mocks.deleteWebhook).not.toHaveBeenCalled()
    expect(foreignMute).toEqual(REFUSED)
    // Identical, so the action cannot be used to probe the base for live record ids.
    expect(foreignDelete).toEqual(absent)
  })

  it('turns a slug ref into the record id, so it expires the tag the read carries', async () => {
    const actions = await loadActions()
    mocks.getWebhookForAuthz.mockResolvedValue(subscription(EVENT_A))

    await actions.setWebhookEnabledAction(EVENT_A, 'recWh1', false)
    await actions.setWebhookEnabledAction(SLUG, 'recWh1', false)

    // Both calls carry the RECORD ID, so both build `event:recEvent000000001:webhooks`, which
    // is what `listWebhooks` subscribes to. Handing the slug on builds `event:<slug>:webhooks`
    // instead: a tag nothing reads, so the settings page keeps serving the muted row as live.
    const named = expect.objectContaining({ eventId: EVENT_A })
    expect(mocks.setWebhookEnabled).toHaveBeenNthCalledWith(1, named)
    expect(mocks.setWebhookEnabled).toHaveBeenNthCalledWith(2, named)
    expect(eventWebhooksTag(EVENT_A)).toBe(`event:${EVENT_A}:webhooks`)
    expect(eventWebhooksTag(EVENT_A)).not.toContain(SLUG)
    // And the authorization saw the record id too, not the ref it was handed.
    expect(mocks.requireEventRole).toHaveBeenNthCalledWith(2, EVENT_A, 'admin')
  })

  it('creates under the resolved id, which is what the event LINK column needs', async () => {
    const actions = await loadActions()

    const result = await actions.createWebhookAction(SLUG, {
      url: 'https://example.com/hooks/bodo',
      name: '',
      events: ['submission.created'],
      enabled: true,
    })

    expect(result.ok).toBe(true)
    // A slug here is not only a wrong tag: Airtable cannot link a row by anything but a
    // record id, so the subscription would be created attached to no event at all.
    expect(mocks.createWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT_A, name: 'example.com' }),
    )
  })
})
