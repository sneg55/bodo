// Requesting a magic link, and consuming one.
//
// The single-use property is the whole point of this file, and it is enforced
// through `claimOnce('jti:<jti>', holder, remainingTtlMs)`, which is backed by the
// ClaimGuard Durable Object. Not a KV denylist: KV is eventually consistent with no
// atomic read-modify-write, so two requests carrying the same link can both read
// "unused" and both mint a session. A token that is sometimes double-use is not
// single-use.
//
// Both entry points take their side effects as arguments (the claim, the send, the
// session write) because each of those reaches for a binding or a request scope.
// That is also what makes the three cases that matter testable: first use wins,
// immediate replay is AUTH_TOKEN_REUSED, an expired link is AUTH_TOKEN_EXPIRED.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  authSecret,
  mintMagicLinkToken,
  type SessionSubject,
  subjectId,
  verifyMagicLinkToken,
} from '@/features/auth/tokens'
import type { EmailMessage, SendResult } from '@/services/email/send'
import { sendEmail } from '@/services/email/send'
import { appUrl } from '@/utils/env'

/** Which app the link signs into. Decides how an unknown email is treated. */
export type MagicLinkAudience = 'speaker' | 'admin'

/**
 * Email to subject. Supplied by the caller because it is a data-layer question:
 * the speaker path find-or-creates a Speakers row (CFP step 2 must work before the
 * email is ever verified), and the admin path looks up an existing AdminUsers row
 * and returns undefined when there is none.
 */
export type SubjectResolver = (input: {
  email: string
  audience: MagicLinkAudience
}) => Promise<SessionSubject | undefined>

/** Exactly `claimOnce` from src/utils/cf.ts, injected so tests need no binding. */
export type ClaimFn = (
  key: string,
  holder: string,
  ttlMs: number,
) => Promise<{ granted: boolean; heldBy?: string }>

/** Exactly `establishSession` from session.ts, which needs a request scope. */
export type SessionEstablisher = (input: {
  subject: SessionSubject
  nowMs: number
}) => Promise<void>

export type SendFn = (message: EmailMessage) => Promise<SendResult>

/**
 * The copy wrapped around the link, for a caller whose message is not "you asked to sign in".
 *
 * It takes the URL because the URL is minted in here and is not knowable before the call.
 * One caller supplies one: the team invitation, which has to name the event and the role or
 * it arrives as an unexplained credential for a product the recipient has never heard of
 * (`features/team/invite-email.ts`). Every other caller genuinely IS a sign-in request, so
 * the default below stays the default rather than each call site restating it.
 *
 * What a composer may NOT change is the recipient, the token, or the idempotency key. Those
 * belong to this file, and the link is the same single-use link either way.
 */
export type MessageComposer = (url: string) => { subject: string; html: string }

/** The route handler that issues and verifies links. */
export const MAGIC_LINK_PATH = '/api/auth/magic'

export function magicLinkUrl(options: { token: string; origin: string }): string {
  const url = new URL(MAGIC_LINK_PATH, options.origin)
  url.searchParams.set('token', options.token)
  return url.toString()
}

export type RequestedMagicLink = {
  subject: SessionSubject
  /** Returned so a route handler can log it and a test can follow it. */
  url: string
  jti: string
  expiresAtMs: number
  /** False when no email provider is configured; the message was only logged. */
  delivered: boolean
}

export async function requestMagicLink(options: {
  email: string
  audience: MagicLinkAudience
  nowMs: number
  resolveSubject: SubjectResolver
  /** Same-site path to land on after the link is consumed, e.g. `/portal`. */
  redirectTo?: string
  secret?: Uint8Array
  origin?: string
  send?: SendFn
  /** Overrides the sign-in copy. See `MessageComposer`; the link is unchanged. */
  compose?: MessageComposer
}): Promise<RequestedMagicLink> {
  const email = options.email.trim().toLowerCase()
  const subject = await options.resolveSubject({ email, audience: options.audience })
  if (subject === undefined) {
    // The caller decides what the user sees. A login form should answer "check your
    // email" either way, so a stranger cannot use the login page to discover which
    // addresses have accounts.
    throw new AppError(ErrorIds.AUTH_UNKNOWN_ADMIN, 'no account for this email', {
      audience: options.audience,
    })
  }

  const minted = await mintMagicLinkToken({
    subject,
    nowMs: options.nowMs,
    secret: options.secret ?? authSecret(),
    redirectTo: options.redirectTo,
  })
  const url = magicLinkUrl({ token: minted.token, origin: options.origin ?? appUrl() })
  const send = options.send ?? sendEmail

  const message = (options.compose ?? signInMessage)(url)

  const result = await send({
    to: email,
    subject: message.subject,
    html: message.html,
    // One key per mint, so a retried send collapses at the provider while a fresh
    // request for a new link is still a separate message.
    idempotencyKey: `magic-link:${minted.jti}`,
  })

  return {
    subject,
    url,
    jti: minted.jti,
    expiresAtMs: minted.expiresAtMs,
    delivered: result.delivered,
  }
}

export type ConsumedMagicLink = {
  subject: SessionSubject
  /** Where to send the browser next, already checked to be a same-site path. */
  redirectTo?: string
}

export async function consumeMagicLink(options: {
  token: string
  nowMs: number
  claim: ClaimFn
  establish: SessionEstablisher
  secret?: Uint8Array
  /**
   * Identifies this one verification attempt. It MUST be unique per attempt:
   * `claimOnce` grants a repeat claim to the same holder on purpose, so that a
   * retried outbox send does not deadlock against its own lease. A holder derived
   * from the token or the jti would inherit that idempotency and hand a session to
   * every replay.
   */
  holder?: string
}): Promise<ConsumedMagicLink> {
  const verified = await verifyMagicLinkToken({
    token: options.token,
    nowMs: options.nowMs,
    secret: options.secret ?? authSecret(),
  })

  // Held for the token's entire remaining life. Anything shorter and the link
  // becomes usable again while the JWT still verifies. `exp` has one-second
  // granularity, so this is at least 1ms whenever verification passed.
  const remainingTtlMs = Math.max(1, verified.expiresAtMs - options.nowMs)
  const claimed = await options.claim(
    `jti:${verified.jti}`,
    options.holder ?? crypto.randomUUID(),
    remainingTtlMs,
  )
  if (!claimed.granted) {
    throw new AppError(ErrorIds.AUTH_TOKEN_REUSED, 'this magic link has already been used', {
      jti: verified.jti,
      subject: subjectId(verified.subject),
    })
  }

  // Claim first, session second. The other order would let two concurrent
  // verifications both mint a session. The cost is that a failure here burns the
  // link, which is the right trade: the user asks for another one.
  await options.establish({ subject: verified.subject, nowMs: options.nowMs })

  return { subject: verified.subject, redirectTo: verified.redirectTo }
}

/**
 * The default message: somebody typed their address into the sign-in form.
 *
 * It is the fallback rather than the only option because one caller sends this link
 * UNSOLICITED. A person added to an event's team never asked for it, so "Use this link to
 * sign in" tells them nothing about why it arrived, and `compose` lets that caller say.
 */
const signInMessage: MessageComposer = (url) => ({
  subject: 'Your bodo sign-in link',
  html: linkEmailHtml(url),
})

/**
 * The magic link is the one message with no admin-editable template (BUILD_SPEC
 * section 3, EmailOutbox), so its body lives here rather than in EmailTemplates.
 * Inline styles and a visible URL because a mail client strips stylesheets and
 * some of them mangle the anchor.
 */
function linkEmailHtml(url: string): string {
  return [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">',
    '<p>Use this link to sign in. It works once and expires in 15 minutes.</p>',
    `<p><a href="${url}">Sign in</a></p>`,
    `<p style="color:#666;font-size:13px;word-break:break-all">${url}</p>`,
    '<p style="color:#666;font-size:13px">If you did not ask for this, ignore it.</p>',
    '</div>',
  ].join('')
}
