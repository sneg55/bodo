// The only place Cloudflare bindings are read.
//
// Nothing else in the codebase should know it is running on Workers. Features ask
// for a capability (`getUploadBucket()`, `getKv()`), and in `next dev` without
// bindings they get an in-memory stand-in so the app still boots.
//
// The stand-ins are deliberately dumb and deliberately not production paths: a
// Map neither survives an isolate nor is shared between two of them, which is
// exactly the bug the real binding exists to avoid. They are here so the UI is
// workable before any infrastructure exists, and `cf:preview` proves the real path.
//
// So a stand-in is gated on DEPLOY_ENV, not on "did the binding happen to be
// there". Falling back because a binding is absent means a renamed or forgotten
// binding in wrangler.jsonc degrades production silently, and each capability
// below has to say out loud whether degrading is survivable. `claimOnce` says no.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { type BucketLike, getBindings, type KvLike } from '@/utils/cf-bindings'
import { isLocalDeploy } from '@/utils/env'

// The binding lookup lives in cf-bindings.ts and the claim protocol in cf-claims.ts. Both
// are re-exported here so this file stays the one import path features and tests use for
// the Cloudflare boundary: the split is an internal matter of file size and concern.
export type { BucketLike, DurableNamespaceLike, KvLike } from '@/utils/cf-bindings'
export { claimOnce, releaseClaim } from '@/utils/cf-claims'

const memoryKv = new Map<string, { value: string; expiresAt?: number }>()

const inMemoryKv: KvLike = {
  get(key) {
    const hit = memoryKv.get(key)
    if (hit === undefined) return Promise.resolve(null)
    if (hit.expiresAt !== undefined && hit.expiresAt < nowMs()) {
      memoryKv.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(hit.value)
  },
  put(key, value, options) {
    const ttl = options?.expirationTtl
    memoryKv.set(key, {
      value,
      expiresAt: ttl === undefined ? undefined : nowMs() + ttl * 1000,
    })
    return Promise.resolve()
  },
  delete(key) {
    memoryKv.delete(key)
    return Promise.resolve()
  },
}

function nowMs(): number {
  return new Date().getTime()
}

/**
 * Key-value store for rate limits and other best-effort counters.
 *
 * NOT for magic-link single-use enforcement, which used to live here. KV is
 * eventually consistent and offers no atomic read-modify-write, so two
 * verifications of one link can both read "unused" and both mint a session.
 * `claimOnce()` below is the correct tool for anything that must happen once.
 *
 * This one DOES fall back to memory on a deployment, and the asymmetry with
 * `claimOnce` is the decision, not an oversight. What KV holds here is
 * best-effort counters, so a per-isolate Map weakens a rate limit (a caller gets
 * its allowance again on each new isolate) without ever granting anything twice.
 * That is a degraded defence, which is survivable; refusing to serve because a
 * counter has nowhere to live would take the whole site down over a rate limit.
 * The warning is what stops it being silent, because the same missing binding
 * would otherwise only show up as unexplained traffic.
 */
export async function getKv(): Promise<KvLike> {
  const env = await getBindings()
  if (env.BODO_KV !== undefined) return env.BODO_KV

  if (!isLocalDeploy()) {
    console.warn(
      `[${ErrorIds.CFG_BINDING_MISSING}] BODO_KV is not bound; rate limits are per-isolate and reset with every isolate`,
    )
  }
  return inMemoryKv
}

/**
 * R2 bucket for headshots, slides, and documents. There is no local fallback:
 * a silent no-op upload would look like success and lose the file, so callers
 * must surface the missing binding to the user instead.
 */
export async function getUploadBucket(): Promise<BucketLike> {
  const env = await getBindings()
  if (env.BODO_UPLOADS === undefined) {
    throw new AppError(
      ErrorIds.CFG_BINDING_MISSING,
      'BODO_UPLOADS is not bound; run `npm run cf:preview` or configure wrangler.jsonc',
      { binding: 'BODO_UPLOADS' },
    )
  }
  return env.BODO_UPLOADS
}

export async function hasUploadBucket(): Promise<boolean> {
  const env = await getBindings()
  return env.BODO_UPLOADS !== undefined
}
