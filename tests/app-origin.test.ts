// The check that catches an APP_URL pointing somewhere nothing is listening.
//
// Worth pinning rather than trusting to review: the whole reason this exists is
// that a wrong APP_URL produces no error anywhere, so a regression in the check
// itself would also be silent.

import { describe, expect, it } from 'vitest'

import { checkServingOrigin } from '@/utils/app-origin'
import { type Env, parseEnv } from '@/utils/env'

function env(source: Record<string, string>): Env {
  return parseEnv(source)
}

describe('checkServingOrigin', () => {
  it('accepts a request arriving on the configured origin', () => {
    const verdict = checkServingOrigin(
      'http://localhost:8787/admin/rec1/cms/embeds',
      env({ APP_URL: 'http://localhost:8787' }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('rejects a port mismatch, which is the failure that shipped', () => {
    // .dev.vars said 8788, the Worker answered on 8787, and every generated
    // <iframe src> pointed at a port nothing served.
    const verdict = checkServingOrigin(
      'http://localhost:8787/',
      env({ APP_URL: 'http://localhost:8788' }),
    )
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.message).toContain('8788')
    expect(verdict.message).toContain('http://localhost:8787')
  })

  it('rejects a host mismatch', () => {
    const verdict = checkServingOrigin(
      'https://bodo.example.com/portal',
      env({ APP_URL: 'https://old-host.example.com' }),
    )
    expect(verdict.ok).toBe(false)
  })

  it('treats 127.0.0.1 and localhost as the same machine', () => {
    expect(
      checkServingOrigin('http://127.0.0.1:8787/', env({ APP_URL: 'http://localhost:8787' })).ok,
    ).toBe(true)
    expect(
      checkServingOrigin('http://localhost:8787/', env({ APP_URL: 'http://127.0.0.1:8787' })).ok,
    ).toBe(true)
  })

  it('says nothing when APP_URL is unset, because the schema owns that case', () => {
    expect(checkServingOrigin('http://localhost:3000/', env({})).ok).toBe(true)
  })
})

describe('checkServingOrigin, how loudly it fails', () => {
  it('is fatal off a production deploy, where a 500 is the fastest teacher', () => {
    for (const DEPLOY_ENV of ['local', 'preview']) {
      const verdict = checkServingOrigin(
        'http://localhost:8787/',
        env({ DEPLOY_ENV, APP_URL: 'http://localhost:8788' }),
      )
      expect(verdict.ok).toBe(false)
      if (verdict.ok) return
      expect(verdict.fatal).toBe(true)
    }
  })

  it('is non-fatal in production, where the Worker answers on more than one host', () => {
    // A *.workers.dev subdomain alongside a custom domain is normal. Taking the
    // site down over a link-building setting would be the worse failure.
    const verdict = checkServingOrigin('https://bodo.workers.dev/', {
      ...env({
        DEPLOY_ENV: 'production',
        APP_URL: 'https://bodo.example.com',
        AIRTABLE_TOKEN: 'pat_test',
        AIRTABLE_BASE_ID: 'app_test',
        SESSION_SECRET: 'x'.repeat(32),
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'cfp@bodo.example.com',
        R2_PUBLIC_BASE_URL: 'https://files.bodo.example.com',
        CRON_SECRET: 'cron_test',
      }),
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.fatal).toBe(false)
  })
})
