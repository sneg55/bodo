// Consuming a link. This is where single use is decided, so the three cases the
// spec names are all here: first use wins, an immediate replay is AUTH_TOKEN_REUSED,
// and an expired link is AUTH_TOKEN_EXPIRED without the guard being touched.

import { describe, expect, it } from 'vitest'

import { consumeMagicLink, requestMagicLink } from '@/features/auth/magic-link'
import { MAGIC_LINK_TTL_MS, type SessionSubject } from '@/features/auth/tokens'

import {
  ADMIN,
  errorIdOf,
  fakeEstablisher,
  fakeGuard,
  fakeSender,
  ORIGIN,
  SECRET,
  SPEAKER,
  T0,
} from './helpers/auth-fakes'

/** Goes through the real request path, so the tests consume a genuinely minted link. */
async function mintLinkFor(subject: SessionSubject, redirectTo?: string): Promise<string> {
  const requested = await requestMagicLink({
    email: 'speaker@example.com',
    audience: 'speaker',
    nowMs: T0,
    secret: SECRET,
    origin: ORIGIN,
    send: fakeSender().send,
    redirectTo,
    resolveSubject: () => Promise.resolve(subject),
  })
  return new URL(requested.url).searchParams.get('token') ?? ''
}

describe('consumeMagicLink', () => {
  it('first use establishes the session and claims the jti for the token life', async () => {
    const token = await mintLinkFor(SPEAKER)
    const guard = fakeGuard(T0)
    const establisher = fakeEstablisher()

    const consumed = await consumeMagicLink({
      token,
      nowMs: T0,
      secret: SECRET,
      claim: guard.claim,
      establish: establisher.establish,
    })

    expect(consumed.subject).toEqual(SPEAKER)
    expect(establisher.established).toEqual([SPEAKER])
    expect([...guard.held.keys()]).toHaveLength(1)
    expect([...guard.held.keys()][0].startsWith('jti:')).toBe(true)
    // Held until the JWT itself dies, never less: a shorter hold would let the link
    // work again while it still verifies.
    expect([...guard.held.values()][0].expiresAt).toBeGreaterThan(T0 + MAGIC_LINK_TTL_MS - 1_000)
  })

  it('rejects an immediate replay with AUTH_TOKEN_REUSED and establishes no second session', async () => {
    const token = await mintLinkFor(SPEAKER)
    const guard = fakeGuard(T0)
    const establisher = fakeEstablisher()

    await consumeMagicLink({
      token,
      nowMs: T0,
      secret: SECRET,
      claim: guard.claim,
      establish: establisher.establish,
    })

    expect(
      await errorIdOf(
        async () =>
          await consumeMagicLink({
            token,
            nowMs: T0 + 5,
            secret: SECRET,
            claim: guard.claim,
            establish: establisher.establish,
          }),
      ),
    ).toBe('E_AUTH_003')
    expect(establisher.established).toEqual([SPEAKER])
  })

  it('rejects a replay from a second attempt with its own holder', async () => {
    // The guard grants a repeat claim to the same holder on purpose, so a consumer
    // that derived its holder from the token or the jti would hand out a session on
    // every replay. Distinct holders per attempt is the property being pinned.
    const token = await mintLinkFor(SPEAKER)
    const guard = fakeGuard(T0)
    const establisher = fakeEstablisher()

    await consumeMagicLink({
      token,
      nowMs: T0,
      secret: SECRET,
      claim: guard.claim,
      establish: establisher.establish,
      holder: 'request-1',
    })

    expect(
      await errorIdOf(
        async () =>
          await consumeMagicLink({
            token,
            nowMs: T0 + 5,
            secret: SECRET,
            claim: guard.claim,
            establish: establisher.establish,
            holder: 'request-2',
          }),
      ),
    ).toBe('E_AUTH_003')
  })

  it('rejects an expired token with AUTH_TOKEN_EXPIRED before claiming anything', async () => {
    const token = await mintLinkFor(SPEAKER)
    const later = T0 + MAGIC_LINK_TTL_MS + 1_000
    const guard = fakeGuard(later)
    const establisher = fakeEstablisher()

    expect(
      await errorIdOf(
        async () =>
          await consumeMagicLink({
            token,
            nowMs: later,
            secret: SECRET,
            claim: guard.claim,
            establish: establisher.establish,
          }),
      ),
    ).toBe('E_AUTH_002')
    expect(guard.held.size).toBe(0)
    expect(establisher.established).toEqual([])
  })

  it('rejects a tampered token with AUTH_TOKEN_INVALID before claiming anything', async () => {
    const token = await mintLinkFor(SPEAKER)
    const guard = fakeGuard(T0)

    expect(
      await errorIdOf(
        async () =>
          await consumeMagicLink({
            token: `${token}x`,
            nowMs: T0,
            secret: SECRET,
            claim: guard.claim,
            establish: fakeEstablisher().establish,
          }),
      ),
    ).toBe('E_AUTH_001')
    expect(guard.held.size).toBe(0)
  })

  it('refuses a token signed with a different secret', async () => {
    const token = await mintLinkFor(SPEAKER)

    expect(
      await errorIdOf(
        async () =>
          await consumeMagicLink({
            token,
            nowMs: T0,
            secret: new TextEncoder().encode('a-completely-different-32-byte-key!!'),
            claim: fakeGuard(T0).claim,
            establish: fakeEstablisher().establish,
          }),
      ),
    ).toBe('E_AUTH_001')
  })

  it('gives two links two claims, so consuming one does not burn the other', async () => {
    const first = await mintLinkFor(SPEAKER)
    const second = await mintLinkFor(SPEAKER)
    const guard = fakeGuard(T0)
    const establisher = fakeEstablisher()

    await consumeMagicLink({
      token: first,
      nowMs: T0,
      secret: SECRET,
      claim: guard.claim,
      establish: establisher.establish,
    })
    await consumeMagicLink({
      token: second,
      nowMs: T0,
      secret: SECRET,
      claim: guard.claim,
      establish: establisher.establish,
    })

    expect(guard.held.size).toBe(2)
    expect(establisher.established).toHaveLength(2)
  })

  it('carries a signed same-site redirect through to the caller', async () => {
    const token = await mintLinkFor(SPEAKER, '/portal/submissions')

    const consumed = await consumeMagicLink({
      token,
      nowMs: T0 + 1_000,
      secret: SECRET,
      claim: fakeGuard(T0).claim,
      establish: fakeEstablisher().establish,
    })

    expect(consumed.redirectTo).toBe('/portal/submissions')
  })

  it('establishes an admin session for an admin link', async () => {
    const token = await mintLinkFor(ADMIN)
    const establisher = fakeEstablisher()

    const consumed = await consumeMagicLink({
      token,
      nowMs: T0,
      secret: SECRET,
      claim: fakeGuard(T0).claim,
      establish: establisher.establish,
    })

    expect(consumed.subject).toEqual(ADMIN)
    expect(establisher.established).toEqual([ADMIN])
  })
})
