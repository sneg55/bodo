// The one door out to an email provider.
//
// Everything else calls `sendEmail()` and never learns which provider is behind
// it. That is what keeps the provider decision in BUILD_SPEC §7.3 a swap rather than
// a rewrite, and it has now been exercised twice: `EMAIL_PROVIDER=agentmail` selects a
// second adapter with no change above this line.
//
// Two behaviours worth knowing before you call this:
//
//   1. With no credentials configured it does NOT throw. It logs the rendered
//      message and returns a synthetic id. A local demo has to be able to walk the
//      whole accept-and-notify flow without a provider account, and a hard failure
//      there would make the app look broken when it is merely unconfigured. The
//      returned `delivered: false` is how a caller can tell the difference.
//   2. It takes an idempotency key and passes it through. Provider-side
//      idempotency is the second half of the outbox design in §5.3: the ClaimGuard
//      lease stops two workers sending at once, and this key stops a retry after a
//      crashed-but-delivered send from arriving twice.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { sendViaAgentMail } from '@/services/email/agentmail'
import type { EmailMessage, SendResult } from '@/services/email/message'
import { postJson, providerReason, recipients, toBase64 } from '@/services/email/transport'
import { getEnv, hasEmail } from '@/utils/env'

export type { EmailAttachment, EmailMessage, SendResult } from '@/services/email/message'

/** Resend's send endpoint. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const env = getEnv()

  if (!hasEmail()) {
    // Unconfigured, not broken. See note 1 above. A warning rather than info,
    // because on a deployed Worker this line is the only evidence that a speaker
    // never received their magic link.
    console.warn(
      `[email] not configured, logging instead: to=${recipients(message.to).join(',')} subject="${message.subject}"`,
    )
    return { delivered: false, messageId: `logged:${message.idempotencyKey ?? message.subject}` }
  }

  if (env.EMAIL_PROVIDER === 'agentmail') {
    return await sendViaAgentMail(message, env.AGENTMAIL_API_KEY ?? '', env.EMAIL_FROM ?? '')
  }

  if (env.EMAIL_PROVIDER === 'cloudflare') {
    // Deliberately not implemented rather than half-implemented. Cloudflare's
    // send documentation does not state attachment or raw-MIME support, and the
    // calendar invite is a judged P0 that depends on exactly that. An adapter
    // that silently dropped attachments would pass every test and fail the demo.
    throw new AppError(
      ErrorIds.MAIL_SEND_FAIL,
      'EMAIL_PROVIDER=cloudflare is not implemented: attachment support is undocumented, see BUILD_SPEC 7.3',
      { provider: 'cloudflare' },
    )
  }

  return await sendViaResend(message, env.RESEND_API_KEY ?? '', env.EMAIL_FROM ?? '')
}

async function sendViaResend(
  message: EmailMessage,
  apiKey: string,
  from: string,
): Promise<SendResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }
  if (message.idempotencyKey !== undefined) {
    headers['idempotency-key'] = message.idempotencyKey
  }

  const response = await postJson(
    RESEND_ENDPOINT,
    headers,
    {
      from,
      to: recipients(message.to),
      subject: message.subject,
      html: message.html,
      reply_to: message.replyTo,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        // Encoded here, at the provider boundary. See EmailAttachment.content.
        content: toBase64(attachment.content),
        content_type: attachment.contentType,
      })),
    },
    message.idempotencyKey,
  )

  if (!response.ok) {
    const body = await response.text()
    throw new AppError(
      ErrorIds.MAIL_SEND_FAIL,
      // The provider's own words go in the MESSAGE, not only in the context. They were in
      // the context alone and it cost real time: a login returning 500 logged
      // "resend rejected the send: 422" and nothing else, because only `.message` reaches
      // the log line. Reproducing the call by hand to read the body is not a debugging
      // step anybody should need for a provider that already explained itself.
      `resend rejected the send: ${response.status} ${providerReason(body)}`,
      {
        status: response.status,
        // Truncated: a provider error body can be long and this lands in logs.
        body: body.slice(0, 500),
        idempotencyKey: message.idempotencyKey,
      },
    )
  }

  const parsed: { id?: unknown } = await response.json()
  const id = typeof parsed.id === 'string' ? parsed.id : ''
  if (id === '') {
    // A 200 with no id means we cannot record `providerMessageId`, which is what
    // makes the send auditable. Treat it as a failure so the outbox row retries
    // rather than being marked sent with nothing to point at.
    throw new AppError(ErrorIds.MAIL_SEND_FAIL, 'resend returned no message id', {
      idempotencyKey: message.idempotencyKey,
    })
  }

  return { delivered: true, messageId: id }
}
