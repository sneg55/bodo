// The cookie attributes, which are a security decision and therefore worth pinning
// in a test rather than checking by eye in devtools. The read and write paths
// themselves need a Next request scope and are covered by using the app.

import { describe, expect, it } from 'vitest'

import { SESSION_COOKIE_NAME, sessionCookieAttributes } from '@/features/auth/session'
import { SESSION_TTL_MS } from '@/features/auth/tokens'

import { T0 } from './helpers/auth-fakes'

describe('sessionCookieAttributes', () => {
  it('is HttpOnly, Secure, Lax, root-scoped, and lasts 30 days', () => {
    expect(sessionCookieAttributes({ nowMs: T0 })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
      expires: new Date(T0 + SESSION_TTL_MS),
    })
  })

  it('uses Lax and not Strict, because the magic link is a cross-site GET', () => {
    // Strict withholds the cookie on exactly that navigation, which signs the user
    // out at the moment they arrive from their mail client.
    expect(sessionCookieAttributes({ nowMs: T0 }).sameSite).not.toBe('strict')
  })

  it('expires relative to the instant it was passed, not to the process clock', () => {
    const later = sessionCookieAttributes({ nowMs: T0 + 60_000 })

    expect(later.expires.getTime() - T0).toBe(SESSION_TTL_MS + 60_000)
  })

  it('names one cookie, so nothing has to guess the key', () => {
    expect(SESSION_COOKIE_NAME).toBe('bodo_session')
  })
})
