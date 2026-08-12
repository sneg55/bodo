// `claimOnce` is the only thing standing between one magic link and two sessions,
// and between one outbox row and two copies of the same email. The Durable Object
// semantics are covered in tests/claim-guard.test.ts; what is pinned here is the
// boundary around the in-memory fallback, which is correct under `next dev` and a
// silent correctness bug anywhere else.
//
// Every case reloads `@/utils/cf` through a dynamic import because `getEnv()`
// caches its parse per module instance, so DEPLOY_ENV can only be varied by
// resetting the module graph. env.ts is deliberately untouched.

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DurableNamespaceLike, KvLike } from '@/utils/cf'

type CfModule = typeof import('@/utils/cf')

// DEPLOY_ENV=production flips the env schema to strict, so a production load needs
// the whole required set or it fails on config before it ever reaches a binding.
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
}

const LOCAL_ENV = { DEPLOY_ENV: 'local' }
const PREVIEW_ENV = { DEPLOY_ENV: 'preview' }

const ORIGINAL_ENV = { ...process.env }

/**
 * Load a fresh copy of cf.ts with a chosen DEPLOY_ENV and a chosen Cloudflare
 * context. Passing an Error for `bindings` simulates a context failure, which is
 * what plain `next dev` produces and also what a broken deploy produces.
 */
async function loadCf(
  values: Record<string, string>,
  bindings: Record<string, unknown> | Error,
): Promise<CfModule> {
  process.env = { ...ORIGINAL_ENV, ...values }
  vi.resetModules()
  vi.doMock('@opennextjs/cloudflare', () => ({
    getCloudflareContext: () =>
      bindings instanceof Error ? Promise.reject(bindings) : Promise.resolve({ env: bindings }),
  }))
  return await import('@/utils/cf')
}

/** A DO namespace that always answers with one canned claim response. */
function fakeGuard(response: { granted: boolean; heldBy?: string }): {
  namespace: DurableNamespaceLike
  keys: string[]
} {
  const keys: string[] = []
  const namespace: DurableNamespaceLike = {
    idFromName(name) {
      keys.push(name)
      return name
    },
    get() {
      return { fetch: () => Promise.resolve(Response.json(response)) }
    },
  }
  return { namespace, keys }
}

function fakeKv(): KvLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    get: (key) => Promise.resolve(store.get(key) ?? null),
    put: (key, value) => {
      store.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      store.delete(key)
      return Promise.resolve()
    },
  }
}

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to reject')
}

/**
 * The thrown AppError's id and context, read off the object rather than through
 * `isAppError`. `vi.resetModules()` gives the reloaded cf.ts its own copy of
 * errorIds, so the class identity differs from this file's import and
 * `instanceof` would be false for a genuine AppError.
 */
async function appErrorOf(
  run: () => Promise<unknown>,
): Promise<{ id: unknown; context: Record<string, unknown> }> {
  try {
    await run()
  } catch (error) {
    const thrown = error as { id: unknown; context: Record<string, unknown> }
    return { id: thrown.id, context: thrown.context }
  }
  throw new Error('expected the call to reject')
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.doUnmock('@opennextjs/cloudflare')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('claimOnce, local fallback', () => {
  it('grants the first claim and denies a second holder', async () => {
    const { claimOnce } = await loadCf(LOCAL_ENV, {})

    expect(await claimOnce('jti:a', 'holder-1', 60_000)).toEqual({ granted: true })
    expect(await claimOnce('jti:a', 'holder-2', 60_000)).toEqual({
      granted: false,
      heldBy: 'holder-1',
    })
  })

  it('is idempotent for the same holder so a retry does not deadlock on its own lease', async () => {
    const { claimOnce } = await loadCf(LOCAL_ENV, {})

    await claimOnce('outbox:1', 'run-1', 60_000)

    expect(await claimOnce('outbox:1', 'run-1', 60_000)).toEqual({ granted: true })
  })

  it('still falls back when the cloudflare context itself fails under next dev', async () => {
    // The realistic `next dev` shape: the adapter package resolves, because it is
    // a devDependency, but there is no request context to read bindings from.
    const { claimOnce } = await loadCf(LOCAL_ENV, new Error('no cloudflare context'))

    expect(await claimOnce('jti:b', 'holder-1', 60_000)).toEqual({ granted: true })
  })
})

describe('claimOnce, deployed', () => {
  it('refuses to fall back to memory at production and names the missing binding', async () => {
    const { claimOnce } = await loadCf(PRODUCTION_ENV, {})

    expect(await messageOf(() => claimOnce('jti:a', 'holder-1', 60_000))).toContain(
      'BODO_CLAIM_GUARD',
    )
  })

  it('refuses to fall back to memory at preview either', async () => {
    // Preview is the rehearsal for production. A fallback there would hide the
    // exact misconfiguration preview exists to catch.
    const { claimOnce } = await loadCf(PREVIEW_ENV, {})

    expect(await messageOf(() => claimOnce('jti:a', 'holder-1', 60_000))).toContain(
      'BODO_CLAIM_GUARD',
    )
  })

  it('throws a config error id so a missing binding is greppable in the logs', async () => {
    const { claimOnce } = await loadCf(PRODUCTION_ENV, {})

    const thrown = await appErrorOf(() => claimOnce('jti:a', 'holder-1', 60_000))

    expect(thrown.id).toBe('E_CFG_005')
    expect(thrown.context.binding).toBe('BODO_CLAIM_GUARD')
  })

  it('grants nothing from memory after the throw, so two isolates cannot both win', async () => {
    const { claimOnce } = await loadCf(PRODUCTION_ENV, {})

    await expect(claimOnce('jti:shared', 'holder-1', 60_000)).rejects.toThrow()
    // A second attempt must fail the same way rather than reading a Map entry the
    // first attempt left behind.
    await expect(claimOnce('jti:shared', 'holder-2', 60_000)).rejects.toThrow()
  })

  it('delegates to the durable object when the binding is present', async () => {
    const guard = fakeGuard({ granted: true })
    const { claimOnce } = await loadCf(PRODUCTION_ENV, { BODO_CLAIM_GUARD: guard.namespace })

    expect(await claimOnce('jti:a', 'holder-1', 60_000)).toEqual({ granted: true })
    // One DO id per claim key, so keys do not share a serialization domain.
    expect(guard.keys).toEqual(['jti:a'])
  })

  it('passes a denial from the durable object straight through', async () => {
    const guard = fakeGuard({ granted: false, heldBy: 'holder-1' })
    const { claimOnce } = await loadCf(PRODUCTION_ENV, { BODO_CLAIM_GUARD: guard.namespace })

    expect(await claimOnce('jti:a', 'holder-2', 60_000)).toEqual({
      granted: false,
      heldBy: 'holder-1',
    })
  })
})

describe('getKv', () => {
  it('falls back to an in-process map in local dev', async () => {
    const { getKv } = await loadCf(LOCAL_ENV, {})
    const kv = await getKv()

    await kv.put('rate:a', '1')

    expect(await kv.get('rate:a')).toBe('1')
  })

  it('uses the binding when it is present', async () => {
    const kv = fakeKv()
    const { getKv } = await loadCf(PRODUCTION_ENV, { BODO_KV: kv })

    await (await getKv()).put('rate:a', '1')

    expect(kv.store.get('rate:a')).toBe('1')
  })

  it('still falls back outside local, but warns, because a degraded rate limit is survivable', async () => {
    // Deliberately not symmetric with claimOnce: a per-isolate counter weakens a
    // limit, it does not hand out a second session.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getKv } = await loadCf(PRODUCTION_ENV, {})

    const kv = await getKv()
    await kv.put('rate:a', '1')

    expect(await kv.get('rate:a')).toBe('1')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('BODO_KV')
  })

  it('does not warn about the missing binding in local dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { getKv } = await loadCf(LOCAL_ENV, {})

    await getKv()

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('binding lookup failures', () => {
  it('stays quiet under next dev, where there is genuinely no cloudflare context', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { hasUploadBucket } = await loadCf(LOCAL_ENV, new Error('no cloudflare context'))

    expect(await hasUploadBucket()).toBe(false)
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs the reason outside local, so a context failure is visible in wrangler tail', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { hasUploadBucket } = await loadCf(PRODUCTION_ENV, new Error('async context lost'))

    expect(await hasUploadBucket()).toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('E_CFG_005')
  })
})

describe('getUploadBucket', () => {
  it('has no fallback at all, because a no-op upload looks like success', async () => {
    const { getUploadBucket } = await loadCf(LOCAL_ENV, {})

    expect(await messageOf(getUploadBucket)).toContain('BODO_UPLOADS')
  })
})
