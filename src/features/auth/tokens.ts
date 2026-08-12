// The two JWTs bodo signs: the 15 minute magic link and the 30 day session.
//
// Nothing in this file reads the clock or a binding. Every function takes `nowMs`
// and the signing secret, which is what makes expiry testable without waiting and
// signature tampering testable without a live request.
//
// Both kinds are HMAC'd with the SAME secret, so they carry distinct `aud` values
// and verification pins the audience. Without that separation a magic-link token
// pasted straight into the session cookie would verify as a session, and a 30 day
// session token would work as a login link for 30 days. `algorithms` is pinned for
// the same reason: it stops a token whose header claims a different alg from being
// verified under one.

import { errors, jwtVerify, SignJWT } from 'jose'

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { RecordId } from '@/types/domain'

/**
 * Who a request is acting as. Two kinds, spelled out rather than collapsed into a
 * bare id, because a speaker id and an AdminUsers id are both `rec...` strings and
 * confusing them would hand the admin app to a speaker.
 */
export type SessionSubject =
  | {
      readonly kind: 'speaker'
      readonly speakerId: RecordId
      /**
       * Set only while an organizer is acting as this speaker through the admin bar's
       * View Portal control (BUILD_SPEC 5.6). It is the AdminUsers id the impersonation
       * started from, and it is the only thing `Back to Admin Mode` has to work with.
       *
       * Deliberately part of the speaker variant and not a sibling field on the session,
       * so a `user` subject cannot express it at all: an admin session is never
       * impersonating, and that is a type error rather than a convention.
       */
      readonly impersonatorUserId?: RecordId
      /**
       * A single-use grant id for the way back, and the reason it exists is a real
       * escalation rather than tidiness.
       *
       * `impersonatorUserId` alone IS a capability, whatever an earlier comment here
       * claimed: exit re-checked that the NAMED user still holds admin, which is not the
       * same as checking that the bearer of the cookie is that user. So anyone holding a
       * copy of a speaker-level impersonation cookie could exchange it for the
       * originating organizer's ADMIN session. Found by Codex review.
       *
       * This id is claimed exactly once through the ClaimGuard Durable Object when the
       * session goes back to admin, so a replayed cookie finds the grant already spent.
       * It does not make the cookie unstealable, which no bearer token can be; it stops a
       * stolen speaker session from being upgraded past what it was stolen as.
       */
      readonly impersonationGrantId?: string
      readonly viaDemo?: true
    }
  | { readonly kind: 'user'; readonly userId: RecordId; readonly viaDemo?: true }

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const ALGORITHM = 'HS256'
const ISSUER = 'bodo'
const MAGIC_LINK_AUDIENCE = 'bodo:magic-link'
const SESSION_AUDIENCE = 'bodo:session'

/** The record id behind a subject, for logging and for ownership comparisons. */
export function subjectId(subject: SessionSubject): RecordId {
  return subject.kind === 'speaker' ? subject.speakerId : subject.userId
}

export type MagicLinkToken = {
  subject: SessionSubject
  /** What `consumeMagicLink` claims through the ClaimGuard, exactly once. */
  jti: string
  /** Epoch ms at which the token stops verifying. */
  expiresAtMs: number
  /** Same-site path to land on after consumption, when the minter supplied one. */
  redirectTo?: string
}

export async function mintMagicLinkToken(options: {
  subject: SessionSubject
  nowMs: number
  secret: Uint8Array
  redirectTo?: string
}): Promise<{ token: string; jti: string; expiresAtMs: number }> {
  const { subject, nowMs, secret, redirectTo } = options
  const jti = crypto.randomUUID()
  const expiresAtSec = Math.floor((nowMs + MAGIC_LINK_TTL_MS) / 1000)

  const token = await new SignJWT({ kind: subject.kind, nxt: redirectTo })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(MAGIC_LINK_AUDIENCE)
    .setSubject(subjectId(subject))
    .setJti(jti)
    .setIssuedAt(Math.floor(nowMs / 1000))
    .setExpirationTime(expiresAtSec)
    .sign(secret)

  return { token, jti, expiresAtMs: expiresAtSec * 1000 }
}

export async function verifyMagicLinkToken(options: {
  token: string
  nowMs: number
  secret: Uint8Array
}): Promise<MagicLinkToken> {
  const payload = await verify({
    ...options,
    audience: MAGIC_LINK_AUDIENCE,
    // `jti` is what single-use enforcement keys on, so a token without one is
    // rejected rather than silently treated as reusable.
    requiredClaims: ['jti', 'sub', 'exp'],
  })

  const jti = typeof payload.jti === 'string' ? payload.jti : ''
  const expiresAtSec = typeof payload.exp === 'number' ? payload.exp : 0
  if (jti === '' || expiresAtSec === 0) {
    throw invalidToken('magic link token is missing jti or exp')
  }

  return {
    subject: readSubject(payload),
    jti,
    expiresAtMs: expiresAtSec * 1000,
    redirectTo: sameSitePath(payload.nxt),
  }
}

export async function mintSessionToken(options: {
  subject: SessionSubject
  nowMs: number
  secret: Uint8Array
}): Promise<string> {
  const { subject, nowMs, secret } = options
  // The subject id and its kind, plus `imp` on an impersonated speaker session, and
  // deliberately nothing else. Still no role: a role baked into a 30 day token cannot be
  // revoked for 30 days and cannot express a per-event role at all. Capability comes from
  // EventMemberships per request.
  //
  // CORRECTION. This comment used to argue that `imp` is not a capability, on the grounds
  // that it names who STARTED the session rather than what they may do, and that exit
  // re-reads EventMemberships. Codex review showed the argument is wrong: re-reading
  // memberships proves the NAMED USER still holds admin, and proves nothing about whether
  // the bearer of the cookie is that user. So a copy of a speaker-level impersonation
  // cookie could be exchanged for the organizer's ADMIN session, which is an escalation
  // past what the cookie was stolen as.
  //
  // `impg` is what makes the exchange single-use: it is a random grant id claimed exactly
  // once through the ClaimGuard Durable Object when the session goes back to admin, so a
  // replay finds it spent. Both claims are read only together, so a token carrying `imp`
  // with no live grant gets an ordinary speaker session and no way back.
  //
  // Still no role, for the original reason: a role baked into a 30 day token cannot be
  // revoked for 30 days and cannot express a per-event role at all.
  //
  // `demo` records that this session came through the click-to-sign-in door rather than
  // through an emailed link, and it is the one claim here that is NOT about who the
  // bearer is. It exists because turning DEMO_MODE off has to actually close the door:
  // without it the flag only removes the button and 404s the endpoint, while every
  // session already handed out stays valid for the full 30 days, so a deployment that
  // was public yesterday is still public today. `currentSubject` in session.ts refuses a
  // marked token whenever demo mode is off. (Codex review finding.)
  //
  // It grants nothing, so it is not the kind of claim the paragraphs above argue against:
  // it can only ever cause a session to be refused.
  //
  // JSON.stringify drops an undefined value, so an ordinary speaker session mints the same
  // six claims it always did rather than `imp: undefined` placeholders.
  return await new SignJWT({
    kind: subject.kind,
    imp: subject.kind === 'speaker' ? subject.impersonatorUserId : undefined,
    impg: subject.kind === 'speaker' ? subject.impersonationGrantId : undefined,
    demo: subject.viaDemo === true ? true : undefined,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(subjectId(subject))
    .setIssuedAt(Math.floor(nowMs / 1000))
    .setExpirationTime(Math.floor((nowMs + SESSION_TTL_MS) / 1000))
    .sign(secret)
}

export async function verifySessionToken(options: {
  token: string
  nowMs: number
  secret: Uint8Array
}): Promise<SessionSubject> {
  const payload = await verify({
    ...options,
    audience: SESSION_AUDIENCE,
    requiredClaims: ['sub', 'exp'],
  })
  return readSubject(payload)
}

async function verify(options: {
  token: string
  nowMs: number
  secret: Uint8Array
  audience: string
  requiredClaims: string[]
}): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(options.token, options.secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: options.audience,
      requiredClaims: options.requiredClaims,
      // The caller's instant, not the process clock. jose defaults to `new Date()`.
      currentDate: new Date(options.nowMs),
    })
    return payload
  } catch (cause) {
    // Expiry is a distinct outcome because the UI can offer a fresh link for it,
    // whereas a bad signature means the link was mangled or forged.
    if (cause instanceof errors.JWTExpired) {
      throw new AppError(ErrorIds.AUTH_TOKEN_EXPIRED, 'token has expired', {
        audience: options.audience,
      })
    }
    throw invalidToken('token failed verification', options.audience)
  }
}

function invalidToken(message: string, audience?: string): AppError {
  return new AppError(ErrorIds.AUTH_TOKEN_INVALID, message, { audience })
}

function readSubject(payload: Record<string, unknown>): SessionSubject {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const kind = typeof payload.kind === 'string' ? payload.kind : ''
  if (sub === '') throw invalidToken('token carries no subject id')
  // Strictly `=== true`, so a truthy-but-wrong claim reads as absent. The direction is
  // deliberate and opposite to the claims below: this one can only ever cause a session
  // to be REFUSED, so the cautious reading of a malformed value is to keep the session,
  // not to drop it. A forged `demo: true` costs its bearer nothing but access.
  const viaDemo = payload.demo === true ? { viaDemo: true as const } : undefined
  if (kind === 'speaker') {
    // Read only on a speaker token, and only as a non-empty string. A `user` token
    // carrying `imp` is not an error worth refusing a session over: nothing here mints
    // one, and dropping the claim leaves an ordinary admin subject, which is the safe
    // reading. Anything other than a record id string is dropped the same way, so a
    // malformed claim costs the way back rather than granting anything.
    const impersonator = typeof payload.imp === 'string' && payload.imp !== '' ? payload.imp : ''
    const grant = typeof payload.impg === 'string' && payload.impg !== '' ? payload.impg : ''
    // Both or neither. A claim naming an admin with no grant to spend is refused the way
    // back rather than allowed through it, because the grant is what proves the bearer is
    // the organizer who started this rather than somebody replaying their cookie.
    return impersonator === '' || grant === ''
      ? { kind: 'speaker', speakerId: sub, ...viaDemo }
      : {
          kind: 'speaker',
          speakerId: sub,
          impersonatorUserId: impersonator,
          impersonationGrantId: grant,
          ...viaDemo,
        }
  }
  if (kind === 'user') return { kind: 'user', userId: sub, ...viaDemo }
  throw invalidToken(`token carries an unusable subject kind: ${kind}`)
}

/**
 * Characters a same-site path may contain: the unreserved set, the sub-delims, and
 * the path separators from RFC 3986, plus `%` for percent-encoding.
 *
 * An allowlist rather than a blocklist, because blocking known-bad prefixes kept
 * losing. `startsWith('//')` alone waves through `/\evil.example`, which Chrome
 * and Safari normalise to `//evil.example` and follow off-site, and it waves
 * through `/portal\r\nSet-Cookie: x=y`, which is header injection into whatever
 * writes the Location. Backslash, control characters, and whitespace are simply
 * not in the set below, so none of those shapes can survive.
 */
const SAME_SITE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/

/**
 * Post-login redirects are carried inside the signed token rather than as a query
 * parameter, so nobody can mint one without the secret. The path is re-checked
 * anyway: the value originates as a query parameter on the login page, so an
 * attacker who can get a victim to start a login controls it, and a signed open
 * redirect is still an open redirect.
 */
function sameSitePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.startsWith('//')) return undefined
  return SAME_SITE_PATH.test(value) ? value : undefined
}

// `authSecret` used to live here and now lives in ./secret.ts, which is the only part
// of token handling that reads configuration. Re-exported so the call sites that ask
// tokens.ts for a key keep working and the split stays an implementation detail.
export { authSecret } from '@/features/auth/secret'
