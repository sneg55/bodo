// One function, so no write has to remember which invalidation API applies to it.
//
// There used to be three, chosen per caller: `updateTag(tag)` in a Server Action for
// read-your-own-writes, `revalidateTag(tag, 'max')` for other people's screens, and
// `revalidateTag(tag, { expire: 0 })` in a Route Handler, where `updateTag` throws. All
// three belonged to the `cacheComponents` model, which is off (read-cache.ts explains
// why), so this collapses to the one form that works everywhere:
//
//   - `revalidateTag(tag, { expire: 0 })` expires the tag immediately and works in both a
//     Server Action and a Route Handler, which is what the public CFP endpoint and the
//     cron sender need.
//   - It is deliberately NOT the single-argument `revalidateTag(tag)`. That form is a
//     TYPE ERROR in Next 16.2.12 (`profile` is a required parameter in
//     next/dist/server/web/spec-extension/revalidate.d.ts) and logs a deprecation
//     warning at runtime. `{ expire: 0 }` is the same semantics with neither problem:
//     both paths set `pathWasRevalidated` to "static and dynamic", which is what tells
//     the client router its cache is stale.
//   - `updateTag` is not used at all any more. It is Server-Action-only by construction,
//     and half the writes here run in a Route Handler.
//
// Getting this wrong is invisible in development and shows up as a stale admin screen in
// the demo, which is why it is one function rather than a convention.

import { revalidateTag } from 'next/cache'

/**
 * Where the write is running.
 *
 * KEPT even though both branches now do the same thing, and kept on purpose rather than
 * out of inertia: it is a fact about the caller that neither this file nor the caller can
 * derive (`updateTag` distinguished them by throwing), it is passed by every mutation in
 * this directory as well as by Server Actions in `src/features/**`, and dropping it would
 * be a signature change to a dozen functions in exchange for nothing. If a future Next
 * gives Server Actions a stronger invalidation than a Route Handler can use, this is the
 * parameter that carries it, and it will be here.
 */
export type WriteOrigin = 'action' | 'route'

export type Invalidation = {
  /** Tags the acting user is about to read again. */
  own: readonly string[]
  /**
   * Tags on other people's screens. Separate from `own` because it USED to mean
   * stale-while-revalidate rather than immediate expiry; both are immediate now, and the
   * distinction is kept because it still documents which screens a write affects.
   */
  others?: readonly string[]
}

/** Immediate expiry, in seconds, for every tag a write names. */
const EXPIRE_NOW = { expire: 0 } as const

export function invalidate(origin: WriteOrigin, tags: Invalidation): void {
  // `origin` is unread here by design: see WriteOrigin. Both branches of the old
  // implementation are now the same call, so the tags are simply expired together.
  void origin
  for (const tag of [...tags.own, ...(tags.others ?? [])]) {
    revalidateTag(tag, EXPIRE_NOW)
  }
}
