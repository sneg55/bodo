// The only thing standing between a public URL and "drain the outbox now".

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assertCronAuthorized, CRON_SECRET_HEADER } from '@/features/jobs/cron-auth'

function requestWith(secret?: string): Request {
  const headers = new Headers()
  if (secret !== undefined) headers.set(CRON_SECRET_HEADER, secret)
  return new Request('https://bodo.example.com/api/cron/reminders', { method: 'POST', headers })
}

beforeEach(() => {
  process.env.CRON_SECRET = 'correct-horse-battery-staple'
})

describe('assertCronAuthorized', () => {
  it('accepts the configured secret', () => {
    expect(() => assertCronAuthorized(requestWith('correct-horse-battery-staple'))).not.toThrow()
  })

  it('rejects a wrong secret', () => {
    expect(() => assertCronAuthorized(requestWith('wrong'))).toThrow()
  })

  it('rejects a missing header rather than treating absence as trust', () => {
    expect(() => assertCronAuthorized(requestWith())).toThrow()
  })

  it('rejects an empty header', () => {
    expect(() => assertCronAuthorized(requestWith(''))).toThrow()
  })

  it('rejects a correct prefix, so a guessing attack gains nothing from partial matches', () => {
    expect(() => assertCronAuthorized(requestWith('correct-horse'))).toThrow()
  })

  it('rejects a value with the right length but wrong content', () => {
    const sameLength = 'x'.repeat('correct-horse-battery-staple'.length)
    expect(() => assertCronAuthorized(requestWith(sameLength))).toThrow()
  })
})

describe('assertCronAuthorized when the secret is not configured', () => {
  it('refuses every caller rather than leaving the route open', async () => {
    // A forgotten env var must not turn this into a public "send the queued mail
    // now" button. `getEnv` caches, so this needs a fresh module graph to observe
    // an unconfigured environment at all.
    vi.resetModules()
    delete process.env.CRON_SECRET

    const fresh = await import('@/features/jobs/cron-auth')

    expect(() => fresh.assertCronAuthorized(requestWith('anything'))).toThrow(/not configured/)
    expect(() => fresh.assertCronAuthorized(requestWith())).toThrow(/not configured/)
  })
})
