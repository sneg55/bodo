// The lookup half of the Cloudflare boundary: how a binding is found, and what it means
// when one is not there.
//
// Split out of cf.ts when the claim pair grew a release, and it is a split by concern
// rather than by line count: this file answers "what did the runtime hand us", while cf.ts
// decides, per capability, whether a missing answer is survivable. Features never import
// this one. They ask cf.ts for a capability, exactly as before, and the types below are
// re-exported from there so no call site can tell the difference.

import { ErrorIds } from '@/constants/errorIds'
import { isLocalDeploy } from '@/utils/env'

/** Minimal surface bodo uses. Widen as features need more. */
export interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface BucketLike {
  put(key: string, value: ReadableStream | ArrayBuffer, options?: unknown): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream } | null>
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>
  delete(key: string): Promise<void>
}

/**
 * The slice of the Durable Object namespace API bodo uses.
 *
 * `fetch` takes a url plus init rather than a `Request`, which is the narrower of
 * the two forms the real stub accepts and the only one that survives the `next dev`
 * binding proxy. See the note in `claimOnce`.
 */
export interface DurableNamespaceLike {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(url: string, init: RequestInit): Promise<Response> }
}

export interface CloudflareEnv {
  BODO_KV?: KvLike
  BODO_UPLOADS?: BucketLike
  BODO_CLAIM_GUARD?: DurableNamespaceLike
}

/**
 * A binding lookup that came back empty for a reason. Locally that reason is
 * usually "the adapter is not hosting this request", which is expected and would
 * be noise. On a deployment it is a real fault, and it used to disappear into `{}`
 * with no trace at all, so it is logged with the error id to grep for in
 * `wrangler tail`.
 *
 * Note that `next dev` does NOT reach here for most bindings: `next.config.ts`
 * calls `initOpenNextCloudflareForDev()`, so miniflare binds them and the lookup
 * succeeds. Which is exactly why `claimOnce` cannot rely on the binding being
 * absent to detect local dev.
 */
function reportBindingFailure(reason: string, cause: unknown): void {
  if (isLocalDeploy()) return
  console.error(`[${ErrorIds.CFG_BINDING_MISSING}] ${reason}`, cause)
}

export async function getBindings(): Promise<CloudflareEnv> {
  // Two failures, not one. The import failing means the adapter is not installed
  // or not the host; `getCloudflareContext` failing means it is the host but this
  // call has lost its request context. Collapsing them, as a single catch did,
  // makes the second indistinguishable from plain `next dev`.
  let adapter: typeof import('@opennextjs/cloudflare')
  try {
    adapter = await import('@opennextjs/cloudflare')
  } catch (error) {
    reportBindingFailure('the @opennextjs/cloudflare adapter could not be loaded', error)
    return {}
  }

  try {
    // No assertion: with worker-configuration.d.ts committed, the adapter's env is
    // already the generated CloudflareEnv, and the local interface above is a
    // structural subset of it.
    const context = await adapter.getCloudflareContext({ async: true })
    return context.env
  } catch (error) {
    reportBindingFailure('no Cloudflare context is available for this request', error)
    return {}
  }
}
