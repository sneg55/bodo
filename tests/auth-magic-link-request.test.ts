// Requesting a link: resolving the email to a subject, minting, and handing the
// rendered message to the injected sender.

import { describe, expect, it } from 'vitest'
import { magicLinkUrl, requestMagicLink } from '@/features/auth/magic-link'
import { MAGIC_LINK_TTL_MS } from '@/features/auth/tokens'
import { ADMIN, errorIdOf, fakeSender, ORIGIN, SECRET, SPEAKER, T0 } from './helpers/auth-fakes'

describe('magicLinkUrl', () => {
  it('points at the verify route with the token as a query parameter', () => {
    expect(magicLinkUrl({ token: 'abc.def.ghi', origin: ORIGIN })).toBe(
      'https://bodo.example/api/auth/magic?token=abc.def.ghi',
    )
  })
})

describe('requestMagicLink', () => {
  it('mints a link for the resolved subject and sends it to the email', async () => {
    const sender = fakeSender()

    const requested = await requestMagicLink({
      email: 'Speaker@Example.com ',
      audience: 'speaker',
      nowMs: T0,
      secret: SECRET,
      origin: ORIGIN,
      send: sender.send,
      resolveSubject: () => Promise.resolve(SPEAKER),
    })

    expect(requested.subject).toEqual(SPEAKER)
    expect(requested.expiresAtMs).toBeLessThanOrEqual(T0 + MAGIC_LINK_TTL_MS)
    expect(requested.delivered).toBe(true)
    expect(sender.sent).toHaveLength(1)
    // Normalised, so a capitalised address does not create a second identity.
    expect(sender.sent[0].to).toBe('speaker@example.com')
    expect(sender.sent[0].html).toContain(requested.url)
    expect(sender.sent[0].idempotencyKey).toBe(`magic-link:${requested.jti}`)
  })

  it('passes the normalised email and the audience to the resolver', async () => {
    const seen: { email: string; audience: string }[] = []

    await requestMagicLink({
      email: '  ADMIN@Example.com',
      audience: 'admin',
      nowMs: T0,
      secret: SECRET,
      origin: ORIGIN,
      send: fakeSender().send,
      resolveSubject: (input) => {
        seen.push(input)
        return Promise.resolve(ADMIN)
      },
    })

    expect(seen).toEqual([{ email: 'admin@example.com', audience: 'admin' }])
  })

  it('throws AUTH_UNKNOWN_ADMIN and sends nothing when no account resolves', async () => {
    const sender = fakeSender()

    expect(
      await errorIdOf(
        async () =>
          await requestMagicLink({
            email: 'stranger@example.com',
            audience: 'admin',
            nowMs: T0,
            secret: SECRET,
            origin: ORIGIN,
            send: sender.send,
            resolveSubject: () => Promise.resolve(undefined),
          }),
      ),
    ).toBe('E_AUTH_006')
    expect(sender.sent).toEqual([])
  })

  it('reports delivered:false so a caller can tell a logged message from a sent one', async () => {
    const requested = await requestMagicLink({
      email: 'speaker@example.com',
      audience: 'speaker',
      nowMs: T0,
      secret: SECRET,
      origin: ORIGIN,
      send: () => Promise.resolve({ delivered: false, messageId: 'logged:x' }),
      resolveSubject: () => Promise.resolve(SPEAKER),
    })

    expect(requested.delivered).toBe(false)
  })
})
