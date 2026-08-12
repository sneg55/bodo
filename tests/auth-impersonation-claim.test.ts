// The one claim admin-to-portal impersonation adds to the session token, at the token
// layer: minting it, reading it back, and every way it can be absent or wrong.
//
// Split out of tests/auth-tokens.test.ts rather than appended to it because that file was
// already near the 300 line limit, and because these cases share a single question the
// others do not ask: can a session claim to have started somewhere it did not.
//
// The forged tokens below are signed with the REAL secret on purpose. Forgery is already
// covered by the tampering cases next door; what these pin is that a correctly signed
// token still cannot carry the claim into a place it does not belong.

import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { mintSessionToken, SESSION_TTL_MS, verifySessionToken } from '@/features/auth/tokens'

import { ADMIN, errorIdOf, SECRET, SPEAKER, T0 } from './helpers/auth-fakes'
import { BASE_SESSION_CLAIMS, decodeSegment, encodeSegment } from './helpers/jwt-segments'

const ACTING = {
  kind: 'speaker',
  speakerId: 'recSpeaker1',
  impersonatorUserId: 'recUser1',
  /** Both claims. The pair is read together, so one without the other is no way back. */
  impersonationGrantId: 'grant-1',
} as const

/** A session token with arbitrary claims, signed the way the real minter signs. */
async function signSession(claims: Record<string, unknown>, sub: string): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('bodo')
    .setAudience('bodo:session')
    .setSubject(sub)
    .setIssuedAt(Math.floor(T0 / 1000))
    .setExpirationTime(Math.floor((T0 + SESSION_TTL_MS) / 1000))
    .sign(SECRET)
}

describe('the impersonation claim on a session token', () => {
  it('round-trips the originating admin id on a speaker session', async () => {
    const token = await mintSessionToken({ subject: ACTING, nowMs: T0, secret: SECRET })

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(ACTING)
  })

  it('adds exactly two claims, and only when impersonating', async () => {
    const acting = await mintSessionToken({ subject: ACTING, nowMs: T0, secret: SECRET })
    const ordinary = await mintSessionToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(Object.keys(decodeSegment(acting.split('.')[1])).sort()).toEqual(
      [...BASE_SESSION_CLAIMS, 'imp', 'impg'].sort(),
    )
    // An ordinary speaker session is exactly what it was before this feature: no
    // `imp: undefined` or `impg: undefined` keys, so nothing about a real speaker's cookie
    // changed.
    expect(Object.keys(decodeSegment(ordinary.split('.')[1])).sort()).toEqual([
      ...BASE_SESSION_CLAIMS,
    ])
  })

  it('reads no claim off an ordinary speaker session', async () => {
    const token = await mintSessionToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    const subject = await verifySessionToken({ token, nowMs: T0, secret: SECRET })
    expect(subject).toEqual(SPEAKER)
    expect(subject.kind === 'speaker' ? subject.impersonatorUserId : 'wrong kind').toBeUndefined()
  })

  it('ignores the claim on a user session, so an admin subject is never impersonating', async () => {
    const token = await signSession({ kind: 'user', imp: 'recSomeoneElse' }, 'recUser1')

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(ADMIN)
  })

  it('refuses a session whose impersonation claim was edited in', async () => {
    const token = await mintSessionToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })
    const [header, payload, signature] = token.split('.')
    const claims = decodeSegment(payload)
    claims.imp = 'recUser1'

    expect(
      await errorIdOf(
        async () =>
          await verifySessionToken({
            token: `${header}.${encodeSegment(claims)}.${signature}`,
            nowMs: T0,
            secret: SECRET,
          }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('drops a claim that is not a record id string', async () => {
    const token = await signSession({ kind: 'speaker', imp: 42 }, 'recSpeaker1')

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(SPEAKER)
  })

  it('drops an empty claim rather than reporting an impersonation by nobody', async () => {
    const token = await signSession({ kind: 'speaker', imp: '' }, 'recSpeaker1')

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(SPEAKER)
  })

  it('drops an admin claim that arrives with no grant to spend', async () => {
    // The pair is read together, and this is the case that makes that matter: a token naming
    // an admin but carrying no single-use grant would otherwise be a way back that nothing
    // can spend once, which is the replay hole. It becomes an ordinary speaker session.
    const token = await signSession({ kind: 'speaker', imp: 'recUser1' }, 'recSpeaker1')

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(SPEAKER)
  })

  it('drops a grant that arrives with no admin named', async () => {
    const token = await signSession({ kind: 'speaker', impg: 'grant-1' }, 'recSpeaker1')

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(SPEAKER)
  })

  it('drops a claim that is a non-empty string but not a record id', async () => {
    // Codex noted the "not a record id" case only supplied a NUMBER, which the typeof check
    // already rejects, so nothing pinned what happens to a plausible-looking string. Nothing
    // validates the shape, and that is fine rather than an oversight: the id is only ever
    // used to look up a membership, and a value matching no member is refused by the role
    // check. This pins the actual behaviour instead of implying a validation that is absent.
    const token = await signSession(
      { kind: 'speaker', imp: 'not-a-record-id', impg: 'grant-1' },
      'recSpeaker1',
    )

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual({
      kind: 'speaker',
      speakerId: 'recSpeaker1',
      impersonatorUserId: 'not-a-record-id',
      impersonationGrantId: 'grant-1',
    })
  })
})
