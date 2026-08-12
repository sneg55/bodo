// The env schema is the thing standing between a deploy and a set of magic links
// pointing at localhost, so its two behaviors are worth pinning: lenient by
// default so `next dev` boots with an empty .env, strict at
// DEPLOY_ENV=production so a half-configured deploy fails loudly.

import { describe, expect, it } from 'vitest'

import { parseEnv } from '@/utils/env'

const PRODUCTION_MINIMUM = {
  DEPLOY_ENV: 'production',
  APP_URL: 'https://bodo.example.com',
  AIRTABLE_TOKEN: 'pat_test',
  AIRTABLE_BASE_ID: 'app_test',
  SESSION_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'cfp@bodo.example.com',
  R2_PUBLIC_BASE_URL: 'https://files.bodo.example.com',
  CRON_SECRET: 'cron_test',
}

function messageOf(source: Record<string, string>): string {
  try {
    parseEnv(source)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected parseEnv to reject')
}

describe('parseEnv, local defaults', () => {
  it('accepts an empty environment so the app boots on fixtures', () => {
    const env = parseEnv({})
    expect(env.DEPLOY_ENV).toBe('local')
    expect(env.ACCELEVENTS_MOCK).toBe(true)
    expect(env.EMAIL_PROVIDER).toBe('resend')
  })

  it('does not invent an APP_URL', () => {
    // A localhost default is what silently emailed localhost magic links.
    expect(parseEnv({}).APP_URL).toBeUndefined()
  })
})

describe('parseEnv, production strictness', () => {
  it('accepts a fully configured production deploy', () => {
    expect(parseEnv(PRODUCTION_MINIMUM).DEPLOY_ENV).toBe('production')
  })

  it('names every missing production key at once', () => {
    const message = messageOf({ DEPLOY_ENV: 'production' })

    for (const key of Object.keys(PRODUCTION_MINIMUM)) {
      if (key === 'DEPLOY_ENV') continue
      expect(message).toContain(key)
    }
  })

  it('rejects a production deploy with no email, because email IS the login', () => {
    const { RESEND_API_KEY: _omitted, ...withoutEmail } = PRODUCTION_MINIMUM

    expect(messageOf(withoutEmail)).toContain('RESEND_API_KEY')
  })

  it('rejects a production deploy with no CRON_SECRET, which would leave /api/cron open', () => {
    const { CRON_SECRET: _omitted, ...withoutSecret } = PRODUCTION_MINIMUM

    expect(messageOf(withoutSecret)).toContain('CRON_SECRET')
  })

  it('stays lenient about those keys outside production', () => {
    expect(() => parseEnv({ DEPLOY_ENV: 'preview' })).not.toThrow()
  })
})

describe('parseEnv, feature-conditional requirements', () => {
  it('requires an Accelevents key only once the mock is switched off', () => {
    expect(() => parseEnv({ ACCELEVENTS_MOCK: '1' })).not.toThrow()

    expect(messageOf({ ACCELEVENTS_MOCK: '0' })).toContain('ACCELEVENTS_API_KEY')
  })

  it('accepts a live Accelevents config', () => {
    const env = parseEnv({ ACCELEVENTS_MOCK: '0', ACCELEVENTS_API_KEY: 'ae_test' })
    expect(env.ACCELEVENTS_MOCK).toBe(false)
  })

  it('mocks the AI by default, so a clone with an empty .env still demos it', () => {
    expect(parseEnv({}).AI_MOCK).toBe(true)
  })

  it('requires an Anthropic key only once the AI mock is switched off', () => {
    // Turning the flag off is the act of promising a live model. A deployment that
    // promises one with no key fails on the first click instead of at config time.
    expect(messageOf({ AI_MOCK: '0' })).toContain('ANTHROPIC_API_KEY')
  })

  it('accepts a live AI config', () => {
    const env = parseEnv({ AI_MOCK: '0', ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(env.AI_MOCK).toBe(false)
  })

  it('does not demand an Anthropic key from a production deploy that never went live', () => {
    // Feature-conditional, not a blanket production requirement.
    expect(parseEnv(PRODUCTION_MINIMUM).AI_MOCK).toBe(true)
  })

  it('rejects a short session secret rather than silently accepting weak signing', () => {
    expect(messageOf({ SESSION_SECRET: 'too-short' })).toContain('SESSION_SECRET')
  })
})

describe('parseEnv, present but unusable', () => {
  it('rejects an http production origin, which would email plaintext links', () => {
    // The session cookie is Secure, so an http origin does not merely look wrong,
    // it cannot establish a session at all.
    expect(messageOf({ ...PRODUCTION_MINIMUM, APP_URL: 'http://bodo.example.com' })).toContain(
      'https',
    )
  })

  it('rejects the resend.dev sender in production', () => {
    // It only delivers to the account owner, so with magic-link auth nobody else
    // could log in. The deploy would look fine and be unusable.
    expect(messageOf({ ...PRODUCTION_MINIMUM, EMAIL_FROM: 'onboarding@resend.dev' })).toContain(
      'EMAIL_FROM',
    )
  })

  it('rejects a provider that has no adapter, at config time', () => {
    expect(messageOf({ EMAIL_PROVIDER: 'cloudflare' })).toContain('EMAIL_PROVIDER')
  })

  it('still accepts resend.dev outside production, where it is a legitimate test path', () => {
    expect(() => parseEnv({ EMAIL_FROM: 'onboarding@resend.dev' })).not.toThrow()
  })
})
