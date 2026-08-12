// `claimOnce` is the wrapper around ClaimGuard, and its job is deciding WHEN the
// Durable Object may be stood in for. That decision is security-relevant in one
// direction and developer experience in the other, so both directions are pinned:
//
//   - On a deployment, a guard that cannot be reached must throw. Falling back to a
//     per-isolate Map there makes a magic link multi-use, which is the exact failure
//     the DO exists to prevent.
//   - On a developer's machine it must fall back, and NOT only when the binding is
//     missing. Under `next dev` the binding exists while its class does not, so every
//     call reached the stub and threw, and signing in returned a 500.
//
// `releaseClaim` routes exactly the same way with one deliberate difference, pinned
// below: it never throws. A claim that cannot be made must stop the caller, because
// proceeding is the double-send. A release that cannot be made has already had its work
// done and written; the only cost is waiting out a lease that expires on its own, so
// throwing would turn a delay into a failed tick and would report failure for work that
// succeeded.
//
// The claim semantics themselves live in tests/claim-guard.test.ts; this file is
// only about the wrapper's routing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import type { DurableNamespaceLike } from '@/utils/cf'

/**
 * The error id, read structurally rather than through `isAppError`.
 *
 * `vi.resetModules()` below gives the module under test a fresh `errorIds` module,
 * so its `AppError` is a different class object from the one this file imported and
 * `instanceof` is false for a perfectly good error. `ErrorIds` is a plain record of
 * strings, so comparing ids across instances is still sound.
 */
function errorIdOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'id' in error ? String(error.id) : undefined
}

/** Bindings the fake adapter hands back; reassigned per test. */
let bindings: { BODO_CLAIM_GUARD?: DurableNamespaceLike } = {}

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => Promise.resolve({ env: bindings }),
}))

/** A namespace whose stub always fails the way `next dev` fails. */
function throwingNamespace(message: string): DurableNamespaceLike {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.reject(new TypeError(message)),
    }),
  }
}

/**
 * A namespace that answers 200 with something that is not JSON.
 *
 * The shape a proxy or an error page produces, and the one case where the status line
 * says the call worked and the body cannot be read.
 */
function unreadableNamespace(): DurableNamespaceLike {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 200 })),
    }),
  }
}

/** A namespace whose stub answers, so the real path is exercised. */
function answeringNamespace(status: number, body: unknown): DurableNamespaceLike {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(new Response(JSON.stringify(body), { status })),
    }),
  }
}

async function claimOnce(...args: Parameters<typeof import('@/utils/cf').claimOnce>) {
  // Imported per test: the module keeps its in-memory claims in module scope, and a
  // shared instance would leak one test's claim into the next.
  const mod = await import('@/utils/cf')
  return await mod.claimOnce(...args)
}

async function releaseClaim(...args: Parameters<typeof import('@/utils/cf').releaseClaim>) {
  const mod = await import('@/utils/cf')
  return await mod.releaseClaim(...args)
}

const PRODUCTION_ENV = {
  DEPLOY_ENV: 'production',
  APP_URL: 'https://bodo.example.com',
  AIRTABLE_TOKEN: 'pat_test',
  AIRTABLE_BASE_ID: 'app_test',
  SESSION_SECRET: 'x'.repeat(32),
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'cfp@bodo.example.com',
  R2_PUBLIC_BASE_URL: 'https://files.bodo.example.com',
  CRON_SECRET: 'cron_test',
  PORTAL_EVENT_ID: 'recTest',
}

/**
 * Through `vi.stubEnv` rather than by assigning `process.env`, which does not
 * typecheck against the project's `ProcessEnv` and would drop the keys the runtime
 * expects to always be there. `vi.unstubAllEnvs()` in afterEach undoes all of it.
 */
function setEnv(values: Record<string, string>): void {
  for (const key of Object.keys(PRODUCTION_ENV)) vi.stubEnv(key, undefined)
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
}

beforeEach(() => {
  vi.resetModules()
  bindings = {}
  // The fallback warns by design; silenced so the suite output stays readable.
  vi.spyOn(console, 'warn').mockImplementation(() => {
    /* intentionally silent */
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('claimOnce on a deployment', () => {
  beforeEach(() => {
    setEnv(PRODUCTION_ENV)
  })

  it('throws rather than standing in when the binding is missing', async () => {
    const error = await claimOnce('jti-1', 'holder-a', 60_000).catch((e: unknown) => e)
    expect(errorIdOf(error)).toBe(ErrorIds.CFG_BINDING_MISSING)
  })

  it('throws rather than standing in when the guard cannot be reached', async () => {
    bindings = { BODO_CLAIM_GUARD: throwingNamespace('Invalid URL') }
    const error = await claimOnce('jti-2', 'holder-a', 60_000).catch((e: unknown) => e)
    expect(errorIdOf(error)).toBe(ErrorIds.CFG_BINDING_FAILED)
  })

  it('throws rather than standing in when the guard answers with an error status', async () => {
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(500, {}) }
    const error = await claimOnce('jti-3', 'holder-a', 60_000).catch((e: unknown) => e)
    expect(errorIdOf(error)).toBe(ErrorIds.CFG_BINDING_FAILED)
  })

  it('throws with a config id when the guard answers with a body it cannot read', async () => {
    // Still a throw, because a verdict that cannot be read is not a verdict and the
    // caller must not proceed. What changed is that it arrives with an id: the bare
    // `.json()` threw a SyntaxError, which was the one claim failure that said nothing
    // greppable in `wrangler tail`.
    setEnv(PRODUCTION_ENV)
    bindings = { BODO_CLAIM_GUARD: unreadableNamespace() }

    const error = await claimOnce('jti:abc', 'req-1', 1000).catch((thrown: unknown) => thrown)

    expect(errorIdOf(error)).toBe(ErrorIds.CFG_BINDING_FAILED)
  })

  it('returns the guard verdict when the guard answers', async () => {
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(200, { granted: false, heldBy: 'other' }) }
    expect(await claimOnce('jti-4', 'holder-a', 60_000)).toEqual({
      granted: false,
      heldBy: 'other',
    })
  })
})

describe('claimOnce on a developer machine', () => {
  beforeEach(() => {
    setEnv({ DEPLOY_ENV: 'local' })
  })

  it('stands in when the binding is missing', async () => {
    expect(await claimOnce('jti-1', 'holder-a', 60_000)).toEqual({ granted: true })
  })

  it('stands in when the binding exists but its class does not, as under next dev', async () => {
    bindings = {
      BODO_CLAIM_GUARD: throwingNamespace('Failed to parse URL from [object Request]'),
    }
    expect(await claimOnce('jti-2', 'holder-a', 60_000)).toEqual({ granted: true })
  })

  it('stands in when the guard answers with an error status', async () => {
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(404, {}) }
    expect(await claimOnce('jti-3', 'holder-a', 60_000)).toEqual({ granted: true })
  })

  it('keeps claim-once semantics while standing in, so a link stays single use', async () => {
    const mod = await import('@/utils/cf')
    expect(await mod.claimOnce('jti-4', 'first', 60_000)).toEqual({ granted: true })
    expect(await mod.claimOnce('jti-4', 'second', 60_000)).toEqual({
      granted: false,
      heldBy: 'first',
    })
    // The same holder retrying must not deadlock against its own lease.
    expect(await mod.claimOnce('jti-4', 'first', 60_000)).toEqual({ granted: true })
  })

  it('prefers a working guard over standing in', async () => {
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(200, { granted: false, heldBy: 'other' }) }
    expect(await claimOnce('jti-5', 'holder-a', 60_000)).toEqual({
      granted: false,
      heldBy: 'other',
    })
  })
})

describe('releaseClaim reports where claimOnce throws', () => {
  // The asymmetry is the decision. A claim that cannot be made must stop the caller: it
  // is the only thing standing between one link and two sessions. A release that cannot
  // be made is bookkeeping after the fact, and the lease it failed to drop expires by
  // itself, so the cost is a wait rather than a wrong result.

  it('does not throw on a deployment when the binding is missing', async () => {
    setEnv(PRODUCTION_ENV)

    expect(await releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({ released: false })
  })

  it('does not throw on a deployment when the guard cannot be reached', async () => {
    setEnv(PRODUCTION_ENV)
    bindings = { BODO_CLAIM_GUARD: throwingNamespace('connection lost') }

    expect(await releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({ released: false })
  })

  it('does not throw on a deployment when the guard answers with an error status', async () => {
    setEnv(PRODUCTION_ENV)
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(500, {}) }

    expect(await releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({ released: false })
  })

  it('logs the missing binding with the config id, so a silent no-op is still greppable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      /* intentionally silent */
    })
    setEnv(PRODUCTION_ENV)

    await releaseClaim('prescreen:r1:s1', 'tick-a')

    expect(String(error.mock.calls.at(0)?.at(0))).toContain(ErrorIds.CFG_BINDING_MISSING)
  })

  it('does not throw when the guard answers 200 with a body it cannot read', async () => {
    // The one path that used to escape the policy. Every failure above is caught and
    // reported, and then the verdict was parsed outside all of them, so a 200 carrying a
    // proxy's error page threw out of a function documented as never throwing. The enqueue
    // awaits this without a catch, so the throw arrived after the rows were written and
    // told the organizer the round had failed to queue.
    setEnv(PRODUCTION_ENV)
    bindings = { BODO_CLAIM_GUARD: unreadableNamespace() }

    expect(await releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({ released: false })
  })

  it('passes the guard verdict through when the guard answers', async () => {
    setEnv(PRODUCTION_ENV)
    bindings = { BODO_CLAIM_GUARD: answeringNamespace(200, { released: false, heldBy: 'other' }) }

    expect(await releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({
      released: false,
      heldBy: 'other',
    })
  })

  it('frees the in-memory claim locally, and only for the holder that owns it', async () => {
    setEnv({ DEPLOY_ENV: 'local' })
    const mod = await import('@/utils/cf')
    await mod.claimOnce('prescreen:r1:s1', 'tick-a', 840_000)

    expect(await mod.releaseClaim('prescreen:r1:s1', 'tick-b')).toEqual({
      released: false,
      heldBy: 'tick-a',
    })
    expect(await mod.releaseClaim('prescreen:r1:s1', 'tick-a')).toEqual({ released: true })
    // Free immediately rather than fourteen minutes from now, which is the point.
    expect(await mod.claimOnce('prescreen:r1:s1', 'tick-b', 840_000)).toEqual({ granted: true })
  })
})
