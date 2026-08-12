// The rules in src/features/webhooks/dispatch.ts that no integration test would catch.
//
// A signature is either verifiable by the receiver or it is not, and a wrong one fails at
// THEIR end, silently, as a 401 nobody here reads. So the byte-exactness of what gets signed
// is asserted directly rather than inferred from a POST going out.
//
// The network call itself is deliberately not tested: `postWebhook` is a fetch and a try, and
// the only decision it makes lives in `classifyWebhookOutcome`, which is pure and is tested.

import { describe, expect, it } from 'vitest'
import { classifyWebhookOutcome, WEBHOOK_MAX_ATTEMPTS } from '@/features/webhooks/deliver'
import {
  discordContent,
  isDiscordWebhookUrl,
  prepareWebhookDelivery,
  selectSubscriptions,
  signWebhookBody,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDispatch,
  type WebhookEventPayload,
  type WebhookSubscription,
  webhookBody,
} from '@/features/webhooks/dispatch'

const SUBMISSION = { id: 'recSub1', code: 'SESS-12', title: 'Agents in production' }
const DISCORD_URL = 'https://discord.com/api/webhooks/123/token'
const PLAIN_URL = 'https://ops.example.com/bodo-hook'

const subscription = (over: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id: 'recHook1',
  eventId: 'recEvt1',
  url: PLAIN_URL,
  secret: 'sh-secret',
  events: [...WEBHOOK_EVENT_TYPES],
  enabled: true,
  ...over,
})

const dispatchOf = (payload: WebhookEventPayload): WebhookDispatch => ({
  id: 'whk_01',
  eventId: 'recEvt1',
  occurredAt: '2026-08-11T10:00:00.000Z',
  payload,
})

const created = dispatchOf({
  type: 'submission.created',
  submission: SUBMISSION,
  speaker: { id: 'recSpk1', name: 'Ada Lovelace' },
})

const parse = (body: string): Record<string, unknown> => JSON.parse(body) as Record<string, unknown>

/** Same object, keys in a different order: semantically equal, byte-wise not. */
function reorder(body: string): string {
  const entries = Object.entries(parse(body)).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(Object.fromEntries(entries))
}

describe('webhook signatures', () => {
  it('is stable for the same body and key', async () => {
    const once = await signWebhookBody('key', '{"a":1}')
    const twice = await signWebhookBody('key', '{"a":1}')

    expect(once).toBe(twice)
  })

  it('changes when the body changes and when the key changes', async () => {
    const base = await signWebhookBody('key', '{"a":1}')

    expect(await signWebhookBody('key', '{"a":2}')).not.toBe(base)
    expect(await signWebhookBody('other-key', '{"a":1}')).not.toBe(base)
  })

  it('is lowercase hex behind a sha256= prefix', async () => {
    const signature = await signWebhookBody('key', '{"a":1}')

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('covers the exact bytes being sent, not a re-serialization of them', async () => {
    // The receiver HMACs the raw body it read. A sender that signed `JSON.stringify(
    // JSON.parse(body))` would produce a signature nobody can reproduce the moment a key
    // moves, and this is the assertion that would fail if that crept in.
    const request = await prepareWebhookDelivery(subscription(), created)
    const shuffled = reorder(request.body)
    const sent = request.headers['X-Bodo-Signature']

    expect(WEBHOOK_SIGNATURE_HEADER).toBe('X-Bodo-Signature')
    expect(shuffled).not.toBe(request.body)
    expect(await signWebhookBody('sh-secret', request.body)).toBe(sent)
    expect(await signWebhookBody('sh-secret', shuffled)).not.toBe(sent)
  })
})

describe('discord detection', () => {
  it('takes discord.com, discordapp.com and their subdomains', () => {
    expect(isDiscordWebhookUrl(DISCORD_URL)).toBe(true)
    expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/1/t')).toBe(true)
    expect(isDiscordWebhookUrl('https://ptb.discord.com/api/webhooks/1/t')).toBe(true)
  })

  it('is decided on the host, so a lookalike is not Discord', () => {
    // Substring matching would send Discord's shape to all three of these.
    expect(isDiscordWebhookUrl('https://discord.com.attacker.example/collect')).toBe(false)
    expect(isDiscordWebhookUrl('https://evil.example/?to=discord.com')).toBe(false)
    expect(isDiscordWebhookUrl('https://notdiscord.com/api/webhooks/1/t')).toBe(false)
  })

  it('is not tripped up by an unparseable url', () => {
    expect(isDiscordWebhookUrl('not a url')).toBe(false)
    expect(isDiscordWebhookUrl('')).toBe(false)
  })
})

describe('webhook body shaping', () => {
  it('sends Discord its own { content } shape and nothing else', () => {
    const body = parse(webhookBody(DISCORD_URL, created))

    expect(Object.keys(body)).toEqual(['content'])
    expect(body.content).toContain('SESS-12')
    expect(body.content).toContain('Ada Lovelace')
  })

  it('sends every other url the generic envelope, with no content field', () => {
    const body = parse(webhookBody(PLAIN_URL, created))

    expect(body.content).toBeUndefined()
    expect(body).toMatchObject({
      id: 'whk_01',
      type: 'submission.created',
      occurredAt: '2026-08-11T10:00:00.000Z',
      eventId: 'recEvt1',
    })
  })

  it('names the event in a header on both shapes', async () => {
    const discord = await prepareWebhookDelivery(subscription({ url: DISCORD_URL }), created)
    const plain = await prepareWebhookDelivery(subscription(), created)

    expect(discord.headers['X-Bodo-Event']).toBe('submission.created')
    expect(plain.headers['X-Bodo-Event']).toBe('submission.created')
    expect(plain.headers['X-Bodo-Delivery']).toBe('whk_01')
  })

  it('clamps a Discord message to what Discord will accept', () => {
    const long = dispatchOf({
      type: 'submission.created',
      submission: { ...SUBMISSION, title: 'x'.repeat(4000) },
    })

    expect(discordContent(long).length).toBeLessThanOrEqual(2000)
  })
})

describe('payload per event type', () => {
  it('carries the submission on submission.created', () => {
    const body = parse(webhookBody(PLAIN_URL, created))

    expect(body.data).toEqual({
      submission: SUBMISSION,
      speaker: { id: 'recSpk1', name: 'Ada Lovelace' },
    })
  })

  it('carries both sides of the move on submission.status_changed', () => {
    const dispatch = dispatchOf({
      type: 'submission.status_changed',
      submission: SUBMISSION,
      previousStatus: 'under_review',
      newStatus: 'accepted',
    })

    expect(parse(webhookBody(PLAIN_URL, dispatch))).toMatchObject({
      type: 'submission.status_changed',
      data: { previousStatus: 'under_review', newStatus: 'accepted' },
    })
    expect(discordContent(dispatch)).toContain('accepted')
  })

  it('carries the task and who finished it on task.completed', () => {
    const dispatch = dispatchOf({
      type: 'task.completed',
      task: { id: 'recTask1', title: 'Upload headshot' },
      speaker: { name: 'Ada Lovelace' },
    })

    expect(parse(webhookBody(PLAIN_URL, dispatch)).data).toEqual({
      task: { id: 'recTask1', title: 'Upload headshot' },
      speaker: { name: 'Ada Lovelace' },
    })
    expect(discordContent(dispatch)).toBe('Task completed: **Upload headshot** by Ada Lovelace')
  })

  it('carries the slot on session.published', () => {
    const dispatch = dispatchOf({
      type: 'session.published',
      submission: SUBMISSION,
      slot: {
        startsAt: '2026-09-01T09:00:00.000Z',
        endsAt: '2026-09-01T09:30:00.000Z',
        room: 'Hall A',
      },
    })

    expect(parse(webhookBody(PLAIN_URL, dispatch))).toMatchObject({
      type: 'session.published',
      data: { slot: { room: 'Hall A' } },
    })
    expect(discordContent(dispatch)).toContain('in Hall A')
  })
})

describe('subscription selection', () => {
  it('matches only the subscriptions that asked for this event type', () => {
    const wants = subscription({ id: 'recWants', events: ['task.completed'] })
    const other = subscription({ id: 'recOther', events: ['session.published'] })

    expect(selectSubscriptions([wants, other], 'task.completed').map((row) => row.id)).toEqual([
      'recWants',
    ])
  })

  it('skips a disabled row even when it subscribes to the type', () => {
    // Muting an endpoint must not lose its secret, so the row stays and is filtered here.
    const muted = subscription({ enabled: false, events: ['submission.created'] })

    expect(selectSubscriptions([muted], 'submission.created')).toEqual([])
  })

  it('returns nothing when a row subscribes to no event at all', () => {
    expect(selectSubscriptions([subscription({ events: [] })], 'submission.created')).toEqual([])
  })
})

describe('delivery classification', () => {
  const outcome = (httpStatus: number, attempts = 1) =>
    classifyWebhookOutcome({
      result: { status: httpStatus, ok: httpStatus >= 200 && httpStatus < 300 },
      attempts,
    })

  it('treats any 2xx as sent', () => {
    expect(outcome(200)).toBe('sent')
    expect(outcome(204)).toBe('sent')
  })

  it('retries what a retry can clear', () => {
    expect(outcome(500)).toBe('retry')
    expect(outcome(429)).toBe('retry')
    expect(outcome(408)).toBe('retry')
    // No response at all: a timeout or a refused connection.
    expect(outcome(0)).toBe('retry')
  })

  it('kills a refusal a retry cannot clear', () => {
    // What a deleted Discord webhook and a rotated token answer.
    expect(outcome(404)).toBe('dead')
    expect(outcome(401)).toBe('dead')
    expect(outcome(400)).toBe('dead')
  })

  it('kills anything that has burned the attempt cap', () => {
    expect(outcome(500, WEBHOOK_MAX_ATTEMPTS)).toBe('dead')
    expect(outcome(500, WEBHOOK_MAX_ATTEMPTS - 1)).toBe('retry')
  })
})
