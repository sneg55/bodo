// Token minting and verification, which is where the security properties live:
// expiry, tampering, and the separation between a login link and a session.
//
// Every case pins the instant, so the 15 minute and 30 day boundaries are asserted
// arithmetically instead of by waiting for a clock.

import { describe, expect, it } from 'vitest'

import {
  authSecret,
  MAGIC_LINK_TTL_MS,
  mintMagicLinkToken,
  mintSessionToken,
  SESSION_TTL_MS,
  subjectId,
  verifyMagicLinkToken,
  verifySessionToken,
} from '@/features/auth/tokens'

import { ADMIN, errorIdOf, SECRET, SPEAKER, T0 } from './helpers/auth-fakes'
import { BASE_SESSION_CLAIMS, decodeSegment, encodeSegment } from './helpers/jwt-segments'

const OTHER_SECRET = new TextEncoder().encode('other-secret-at-least-32-bytes-long!')

describe('subjectId', () => {
  it('reads the record id out of either subject kind', () => {
    expect(subjectId(SPEAKER)).toBe('recSpeaker1')
    expect(subjectId(ADMIN)).toBe('recUser1')
  })
})

describe('magic link tokens', () => {
  it('round-trips the subject, a jti, and the 15 minute expiry', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(minted.jti).not.toBe('')
    expect(minted.expiresAtMs).toBe(Math.floor((T0 + MAGIC_LINK_TTL_MS) / 1000) * 1000)

    const verified = await verifyMagicLinkToken({ token: minted.token, nowMs: T0, secret: SECRET })
    expect(verified.subject).toEqual(SPEAKER)
    expect(verified.jti).toBe(minted.jti)
    expect(verified.expiresAtMs).toBe(minted.expiresAtMs)
    expect(verified.redirectTo).toBeUndefined()
  })

  it('mints a distinct jti per link, so two links are independently consumable', async () => {
    const first = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })
    const second = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(first.jti).not.toBe(second.jti)
  })

  it('carries an admin subject without confusing it for a speaker', async () => {
    const minted = await mintMagicLinkToken({ subject: ADMIN, nowMs: T0, secret: SECRET })

    const verified = await verifyMagicLinkToken({ token: minted.token, nowMs: T0, secret: SECRET })
    expect(verified.subject).toEqual(ADMIN)
  })

  it('still verifies one millisecond before expiry', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    const verified = await verifyMagicLinkToken({
      token: minted.token,
      nowMs: minted.expiresAtMs - 1,
      secret: SECRET,
    })
    expect(verified.jti).toBe(minted.jti)
  })

  it('rejects an expired token with AUTH_TOKEN_EXPIRED', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(
      await errorIdOf(
        async () =>
          await verifyMagicLinkToken({
            token: minted.token,
            nowMs: T0 + MAGIC_LINK_TTL_MS + 1_000,
            secret: SECRET,
          }),
      ),
    ).toBe('E_AUTH_002')
  })

  it('rejects a tampered signature with AUTH_TOKEN_INVALID', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })
    const [header, payload, signature] = minted.token.split('.')
    const flipped = `${signature.slice(0, -2)}${signature.slice(-2) === 'AA' ? 'BB' : 'AA'}`

    expect(
      await errorIdOf(
        async () =>
          await verifyMagicLinkToken({
            token: `${header}.${payload}.${flipped}`,
            nowMs: T0,
            secret: SECRET,
          }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('rejects a token whose payload was edited to another subject', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })
    const [header, payload, signature] = minted.token.split('.')
    const claims = decodeSegment(payload)
    claims.sub = 'recSomeoneElse'
    const forged = encodeSegment(claims)

    expect(
      await errorIdOf(
        async () =>
          await verifyMagicLinkToken({
            token: `${header}.${forged}.${signature}`,
            nowMs: T0,
            secret: SECRET,
          }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('rejects a token signed with a different secret', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: OTHER_SECRET })

    expect(
      await errorIdOf(
        async () => await verifyMagicLinkToken({ token: minted.token, nowMs: T0, secret: SECRET }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('rejects a string that is not a JWT at all', async () => {
    expect(
      await errorIdOf(
        async () => await verifyMagicLinkToken({ token: 'not-a-token', nowMs: T0, secret: SECRET }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('carries a same-site redirect path through the signature', async () => {
    const minted = await mintMagicLinkToken({
      subject: SPEAKER,
      nowMs: T0,
      secret: SECRET,
      redirectTo: '/portal/submissions',
    })

    const verified = await verifyMagicLinkToken({ token: minted.token, nowMs: T0, secret: SECRET })
    expect(verified.redirectTo).toBe('/portal/submissions')
  })

  it('drops a redirect that points off-site, including a protocol-relative one', async () => {
    for (const hostile of ['https://evil.example/steal', '//evil.example/steal', 'portal']) {
      const minted = await mintMagicLinkToken({
        subject: SPEAKER,
        nowMs: T0,
        secret: SECRET,
        redirectTo: hostile,
      })

      const verified = await verifyMagicLinkToken({
        token: minted.token,
        nowMs: T0,
        secret: SECRET,
      })
      expect(verified.redirectTo).toBeUndefined()
    }
  })
})

describe('session tokens', () => {
  it('round-trips the subject and nothing else, for 30 days', async () => {
    const token = await mintSessionToken({ subject: ADMIN, nowMs: T0, secret: SECRET })

    expect(await verifySessionToken({ token, nowMs: T0, secret: SECRET })).toEqual(ADMIN)
    expect(
      await verifySessionToken({ token, nowMs: T0 + SESSION_TTL_MS - 2_000, secret: SECRET }),
    ).toEqual(ADMIN)
  })

  it('carries no role claim, so capability cannot be baked in for 30 days', async () => {
    const token = await mintSessionToken({ subject: ADMIN, nowMs: T0, secret: SECRET })
    const claims = decodeSegment(token.split('.')[1])

    expect(Object.keys(claims).sort()).toEqual([...BASE_SESSION_CLAIMS])
  })

  it('expires after 30 days', async () => {
    const token = await mintSessionToken({ subject: ADMIN, nowMs: T0, secret: SECRET })

    expect(
      await errorIdOf(
        async () =>
          await verifySessionToken({ token, nowMs: T0 + SESSION_TTL_MS + 1_000, secret: SECRET }),
      ),
    ).toBe('E_AUTH_002')
  })
})

describe('token audience separation', () => {
  it('refuses a magic link token presented as a session cookie', async () => {
    const minted = await mintMagicLinkToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(
      await errorIdOf(
        async () => await verifySessionToken({ token: minted.token, nowMs: T0, secret: SECRET }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('refuses a session token presented as a magic link', async () => {
    const token = await mintSessionToken({ subject: SPEAKER, nowMs: T0, secret: SECRET })

    expect(
      await errorIdOf(async () => await verifyMagicLinkToken({ token, nowMs: T0, secret: SECRET })),
    ).toBe('E_AUTH_001')
  })
})

describe('authSecret', () => {
  it('is stable within a process, so a dev session survives until restart', () => {
    const first = authSecret()

    expect(authSecret()).toEqual(first)
    expect(first.byteLength).toBeGreaterThanOrEqual(32)
  })
})
