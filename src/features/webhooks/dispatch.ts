// Outbound webhooks: what gets sent, what signs it, and the Discord special case.
//
// Everything here is PURE, and that is where the whole feature's risk sits. Three rules are
// expensive to get wrong and invisible to any test of the network call:
//
//   1. The signature covers the EXACT bytes on the wire. A receiver verifies by HMACing the
//      raw request body it read, so a sender that signs a re-serialization signs something
//      nobody can reproduce: `JSON.stringify(JSON.parse(body))` is equal often enough to
//      pass a casual test and differs the moment a key moves or a number round-trips. So
//      `prepareWebhookDelivery` returns the body string it signed, and the caller must POST
//      that string rather than an object it re-encodes.
//   2. The body is snapshotted, not rebuilt. A retry three hours later re-sends the stored
//      bytes, so adding a field to the payload builder cannot invalidate a signature that
//      has already been computed. WebhookDeliveries.payloadJson is where those bytes live.
//   3. A Discord URL gets Discord's shape. Discord's incoming-webhook endpoint ignores an
//      unknown envelope and answers 400 `Cannot send an empty message`, so the generic
//      payload posted there produces nothing at all: no message, and an error an organizer
//      would read as "webhooks are broken". The AI Engineer team runs the event out of
//      Discord, which is why one vendor earns a branch in a generic dispatcher.
//
// The signature stays on the Discord request too. It costs one HMAC, Discord ignores unknown
// headers, and one code path is worth more than the header it saves.

/** The four things a conference team is told about. Spec §5. */
export const WEBHOOK_EVENT_TYPES = [
  'submission.created',
  'submission.status_changed',
  'task.completed',
  'session.published',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export const WEBHOOK_SIGNATURE_HEADER = 'X-Bodo-Signature'
export const WEBHOOK_EVENT_HEADER = 'X-Bodo-Event'
/** The delivery's idempotency key, so a receiver can drop a repeat of one it has seen. */
export const WEBHOOK_DELIVERY_HEADER = 'X-Bodo-Delivery'

/** Discord rejects a message body over this many characters outright. */
const DISCORD_CONTENT_LIMIT = 2000

/** One endpoint, as the Webhooks table stores it. */
export type WebhookSubscription = {
  id: string
  eventId: string
  url: string
  secret: string
  events: readonly WebhookEventType[]
  enabled: boolean
}

type SubmissionRef = { id: string; code: string; title: string }
type PersonRef = { id?: string; name: string }

/**
 * The event itself, discriminated on `type`.
 *
 * Narrow per-type shapes rather than one bag with everything optional, because the payload
 * is a published contract: a receiver writing `data.submission.code` should be able to know
 * from the type which events carry one.
 */
export type WebhookEventPayload =
  | { type: 'submission.created'; submission: SubmissionRef; speaker?: PersonRef }
  | {
      type: 'submission.status_changed'
      submission: SubmissionRef
      previousStatus?: string
      newStatus: string
    }
  | { type: 'task.completed'; task: { id: string; title: string }; speaker?: PersonRef }
  | {
      type: 'session.published'
      submission: SubmissionRef
      slot: { startsAt: string; endsAt?: string; room?: string }
    }

/**
 * One thing that happened, addressed to one conference.
 *
 * `id` is the delivery's idempotency key and rides in a header, so a receiver that processed
 * it once can drop the retry that follows a timeout it actually handled.
 */
export type WebhookDispatch = {
  id: string
  eventId: string
  occurredAt: string
  payload: WebhookEventPayload
}

/** A POST, ready to make. `body` is the signed bytes and must be sent verbatim. */
export type PreparedWebhookRequest = {
  url: string
  body: string
  headers: Readonly<Record<string, string>>
}

/**
 * The subscriptions that want this event type.
 *
 * Disabled rows are skipped rather than deleted so an organizer can mute a noisy endpoint
 * without losing its secret, which is the value they cannot get back: re-enabling a webhook
 * whose secret changed means redeploying whatever verifies it.
 */
export function selectSubscriptions(
  subscriptions: readonly WebhookSubscription[],
  type: WebhookEventType,
): readonly WebhookSubscription[] {
  return subscriptions.filter((row) => row.enabled && row.events.includes(type))
}

/**
 * Whether this URL is a Discord incoming webhook, decided on the HOST.
 *
 * On the host and never on a substring: `url.includes('discord.com')` also matches
 * `https://discord.com.attacker.example/collect` and `https://evil.example/?r=discord.com`,
 * and getting that wrong sends a payload shaped for one endpoint to another. Subdomains
 * count because `ptb.` and `canary.` are the same service, and an unparseable URL is not
 * Discord (nor anything else; the POST will fail on its own terms).
 */
export function isDiscordWebhookUrl(url: string): boolean {
  if (!URL.canParse(url)) return false
  const host = new URL(url).hostname.toLowerCase()
  return DISCORD_HOSTS.some((discord) => host === discord || host.endsWith(`.${discord}`))
}

const DISCORD_HOSTS = ['discord.com', 'discordapp.com'] as const

/**
 * The generic JSON envelope: what the event is, when, on which conference, and its data.
 *
 * `data` is the payload minus its discriminator, because `type` is already on the envelope
 * and a receiver reading it in two places will eventually branch on the wrong one.
 */
export function webhookPayload(dispatch: WebhookDispatch): Record<string, unknown> {
  const { type, ...data } = dispatch.payload
  return {
    id: dispatch.id,
    type,
    occurredAt: dispatch.occurredAt,
    eventId: dispatch.eventId,
    data,
  }
}

/**
 * One line a human reads in a channel.
 *
 * Deliberately short. A Discord message is glanced at on a phone during a hackathon, so it
 * leads with what happened and carries the session code, which is the string an organizer
 * pastes into bodo's search.
 */
export function discordContent(dispatch: WebhookDispatch): string {
  const payload = dispatch.payload
  switch (payload.type) {
    case 'submission.created':
      return clamp(
        `New submission: **${payload.submission.title}** (${payload.submission.code})${by(payload.speaker)}`,
      )
    case 'submission.status_changed':
      return clamp(
        `Submission **${payload.submission.title}** (${payload.submission.code}) is now \`${payload.newStatus}\`${was(payload.previousStatus)}`,
      )
    case 'task.completed':
      return clamp(`Task completed: **${payload.task.title}**${by(payload.speaker)}`)
    case 'session.published':
      return clamp(
        `Session published: **${payload.submission.title}** (${payload.submission.code}) at ${payload.slot.startsAt}${where(payload.slot.room)}`,
      )
  }
}

const by = (speaker?: PersonRef): string => (speaker === undefined ? '' : ` by ${speaker.name}`)
const was = (previous?: string): string => (previous === undefined ? '' : ` (was \`${previous}\`)`)
const where = (room?: string): string => (room === undefined ? '' : ` in ${room}`)

/** Discord answers 400 rather than truncating, so a long title must not lose the message. */
const clamp = (content: string): string =>
  content.length <= DISCORD_CONTENT_LIMIT
    ? content
    : `${content.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`

/**
 * The exact bytes for this URL: Discord's `{ content }` shape, or the generic envelope.
 *
 * Serialized here, in one place, because this string is what gets signed AND what gets
 * stored on the delivery row. Two call sites building it would be two chances to sign
 * something other than what is sent.
 */
export function webhookBody(url: string, dispatch: WebhookDispatch): string {
  if (isDiscordWebhookUrl(url)) return JSON.stringify({ content: discordContent(dispatch) })
  return JSON.stringify(webhookPayload(dispatch))
}

/**
 * `sha256=<lowercase hex>` over `body`, keyed with the subscription's secret.
 *
 * WebCrypto and not `node:crypto`: this runs on Workers, where there is no `Buffer` and no
 * node builtins. The `sha256=` prefix is GitHub's convention and every webhook-verifying
 * library already knows how to split on it, which matters more than saving eight characters:
 * it also leaves room to rotate the algorithm without changing the header's name.
 */
export async function signWebhookBody(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return `sha256=${toHex(signature)}`
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

/**
 * Everything the POST needs, with the signature computed over the body it returns.
 *
 * Takes the body rather than the event on purpose, because this is also the RETRY path:
 * ./deliver.ts hands it the bytes already stored on the delivery row, so a retry three hours
 * later signs what was enqueued instead of whatever the payload builder has become since.
 * See rule 2 in the file header.
 */
export async function webhookRequest(input: {
  url: string
  secret: string
  body: string
  eventType: WebhookEventType
  deliveryId: string
}): Promise<PreparedWebhookRequest> {
  const signature = await signWebhookBody(input.secret, input.body)
  return {
    url: input.url,
    body: input.body,
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signature,
      [WEBHOOK_EVENT_HEADER]: input.eventType,
      [WEBHOOK_DELIVERY_HEADER]: input.deliveryId,
    },
  }
}

/** The enqueue path: mint the bytes for this subscription's URL, then sign them. */
export async function prepareWebhookDelivery(
  subscription: WebhookSubscription,
  dispatch: WebhookDispatch,
): Promise<PreparedWebhookRequest> {
  return await webhookRequest({
    url: subscription.url,
    secret: subscription.secret,
    body: webhookBody(subscription.url, dispatch),
    eventType: dispatch.payload.type,
    deliveryId: dispatch.id,
  })
}
