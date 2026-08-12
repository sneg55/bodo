// The AgentMail adapter.
//
// It exists because email is the one subsystem this project could not verify end to end.
// Resend needs an account and a verified domain before a single message moves, so every
// flow that ends in a mailbox (the magic link that IS the login, the CFP confirmation,
// the task reminder, the accepted-with-invite) was tested up to `sendEmail` and no
// further. AgentMail hands out a real, addressable mailbox from an API call, so the same
// mailbox can be the sender and the recipient and the test can read what actually
// arrived, headers and attachment included.
//
// It is a peer of the Resend adapter, not a test double: same `EmailMessage` in, same
// `SendResult` out, chosen by `EMAIL_PROVIDER=agentmail`, and it delivers to real
// addresses. Nothing here is reachable unless a deployment names it.
//
// Two things differ from Resend and both are load-bearing:
//
//   1. The SENDER is the inbox in the URL, not a `from` field in the body. So
//      `EMAIL_FROM` has to be an address on an inbox this key owns, and the address is
//      pulled out of it (a display name is allowed and is stripped for the path).
//   2. The idempotency key is CONSTRAINED: 1-256 characters of `A-Za-z0-9-._~`, no `@`.
//      Every key this app mints breaks that rule, so they are hashed. See `keyFor`.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EmailMessage, SendResult } from '@/services/email/message'
import {
  fromAddress,
  postJson,
  providerReason,
  recipients,
  toBase64,
} from '@/services/email/transport'

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0'

/**
 * An idempotency key AgentMail will accept, derived from the one the caller minted.
 *
 * The keys in `src/features/comms/triggers.ts` look like
 * `accepted:recSub1:2026-08-06T:recSpk2` and the admin alert's carries a recipient
 * address, so they contain `:` and `@` and AgentMail answers 400. Substituting the
 * offending characters would be shorter and is wrong: `a:b` and `a.b` would collapse to
 * the same key, and a colliding key does not double-send, it makes the SECOND, different
 * message vanish with a 200 and the first message's id. A SHA-256 hex digest is 64
 * characters of exactly the allowed alphabet, is deterministic across isolates, and
 * cannot collide by accident.
 */
async function keyFor(idempotencyKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sendViaAgentMail(
  message: EmailMessage,
  apiKey: string,
  from: string,
): Promise<SendResult> {
  const inboxId = fromAddress(from)
  if (inboxId === '') {
    throw new AppError(ErrorIds.MAIL_SEND_FAIL, 'EMAIL_FROM has no address to send from', {
      provider: 'agentmail',
    })
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }
  if (message.idempotencyKey !== undefined) {
    headers['idempotency-key'] = await keyFor(message.idempotencyKey)
  }

  const response = await postJson(
    // The inbox id IS the address, so it has to be escaped: an unencoded `@` in a path
    // segment is legal but a `+` in a plus-addressed inbox is not.
    `${AGENTMAIL_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    headers,
    {
      to: [...recipients(message.to)],
      subject: message.subject,
      html: message.html,
      reply_to: message.replyTo === undefined ? undefined : [message.replyTo],
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        // Encoded here, at the provider boundary, exactly as for Resend: the API reads
        // `content` as base64, so raw calendar text would arrive as binary garbage.
        content: toBase64(attachment.content),
        content_type: attachment.contentType,
        content_disposition: 'attachment',
      })),
    },
    message.idempotencyKey,
  )

  if (!response.ok) {
    const body = await response.text()
    throw new AppError(
      ErrorIds.MAIL_SEND_FAIL,
      `agentmail rejected the send: ${response.status} ${providerReason(body)}`,
      {
        status: response.status,
        // Truncated: a provider error body can be long and this lands in logs.
        body: body.slice(0, 500),
        idempotencyKey: message.idempotencyKey,
      },
    )
  }

  const parsed: { message_id?: unknown } = await response.json()
  const id = typeof parsed.message_id === 'string' ? parsed.message_id : ''
  if (id === '') {
    // Same rule as the Resend adapter: a 200 with no id leaves `providerMessageId` empty,
    // which is what makes a send auditable. Fail so the outbox row retries rather than
    // being marked sent with nothing to point at.
    throw new AppError(ErrorIds.MAIL_SEND_FAIL, 'agentmail returned no message id', {
      idempotencyKey: message.idempotencyKey,
    })
  }

  return { delivered: true, messageId: id }
}
