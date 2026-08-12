// The post-login redirect is the one attacker-influenced value that survives a
// magic link, because it starts life as a query parameter on the login page. It is
// signed, so it cannot be forged, but a signed open redirect is still an open
// redirect: it lets a phishing page claim the real domain sent the victim there.
//
// Every case below except the last one passed an earlier `startsWith('//')` check.

import { describe, expect, it } from 'vitest'

import { mintMagicLinkToken, verifyMagicLinkToken } from '@/features/auth/tokens'

const NOW = 1_754_600_000_000
const SUB = { kind: 'speaker', speakerId: 'recSpk1' } as const

const SECRET = new TextEncoder().encode('x'.repeat(32))

async function roundTrip(redirectTo: string) {
  const t = await mintMagicLinkToken({ subject: SUB, nowMs: NOW, secret: SECRET, redirectTo })
  return (await verifyMagicLinkToken({ token: t.token, nowMs: NOW + 1000, secret: SECRET }))
    .redirectTo
}

describe('magic-link redirect validation', () => {
  it('rejects protocol-relative', async () => {
    expect(await roundTrip('//evil.example')).toBeUndefined()
  })
  it('rejects backslash-normalised protocol-relative', async () => {
    // Chrome and Safari normalise a backslash to a forward slash in URLs, so
    // "/\evil.example" is delivered as "//evil.example" by the browser.
    expect(await roundTrip('/\\evil.example')).toBeUndefined()
  })
  it('rejects backslash-slash', async () => {
    expect(await roundTrip('/\\/evil.example')).toBeUndefined()
  })
  it('rejects a CRLF header injection attempt', async () => {
    expect(await roundTrip('/portal\r\nSet-Cookie: a=b')).toBeUndefined()
  })
  it('rejects a tab-obfuscated protocol-relative', async () => {
    expect(await roundTrip('/\t/evil.example')).toBeUndefined()
  })
  it('allows an ordinary in-app path', async () => {
    expect(await roundTrip('/portal/submissions')).toBe('/portal/submissions')
  })
})
