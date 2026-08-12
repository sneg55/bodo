// Where a read's caching is spelled: the tags it subscribes to, and for how long.
//
// This used to be a `'use cache'` function per read in queries.ts, with `cacheTag` and
// `cacheLife` inside it. It is here instead because `@opennextjs/cloudflare` cannot
// resume a partially prerendered route: with `cacheComponents` on, a page whose dynamic
// half needed a resume hung until the Workers runtime cancelled the request, and a page
// servable from its static shell returned 200 with the dynamic half silently missing.
// That was reproduced on the deployed Worker, not only locally, so `cacheComponents` is
// off and `'use cache'`, `cacheTag`, `cacheLife` and `updateTag` are all unavailable.
//
// What survives on workerd is the Data Cache behind `fetch`, and every read in this
// directory is a raw `fetch` through the scheduler. So the cache moved to the request:
// each read declares its tags and its window, client.ts turns them into a RequestInit,
// and `revalidateTag` still expires exactly the same tag vocabulary (tags.ts). The
// judged property is unchanged: a navigation reads Airtable at most once per
// invalidation, not once per request.
//
// Nothing here is Next-specific except the shape of the `next` field, and nothing here
// imports Next, so both halves are unit testable (tests/airtable-read-cache.test.ts).

/** A read may be cached; a write never is. Also picks the error id in client.ts. */
export type RequestKind = 'read' | 'write'

/**
 * The caching one read asks for.
 *
 * `revalidate` is what opts the request into the Data Cache. A read that names tags but
 * no window is NOT cached, and its tags would then invalidate nothing, so the two
 * travel together on every cached read and neither is passed alone.
 */
export type ReadCache = {
  /** What a mutation names to expire this request. A cached read with no tag is a bug. */
  tags?: readonly string[]
  /** Seconds. Absent means uncached, which is what every write-path read wants. */
  revalidate?: number
}

// TWO READS THAT SEND THE SAME REQUEST MUST DECLARE THE SAME TAGS.
//
// The entry is keyed on the request (url, method, headers, body) and NOT on the tags, so a
// bare `listAll` of a table - no filter, no sort, no field list, which is most of the lists in
// this DAL - is byte-identical for every caller and they all share one entry. Two callers
// naming different tags over one key breaks in both directions: the narrower one is served an
// entry that a write naming only the wider one's tags did not expire, and on the file-system
// cache the mismatch additionally rewrites the entry's stored tags WITHOUT refetching it,
// which moves `lastModified` past an expiry another caller had already recorded and hides it
// permanently (next/dist/server/lib/incremental-cache/file-system-cache.js).
//
// So when adding a read, ask what else sends that request, and give it the same tag set rather
// than the narrowest one that describes the caller. Narrowing belongs AFTER the map, in a
// filter, where it costs nothing. Subscribing widely costs one Airtable request; invalidating
// widely costs every screen, which is why the write side stays narrow either way.
//
// Where a read genuinely cannot know the wider scope, the answer is a table-level tag that
// every write to that table names: `adminUsersTag`, `speakerTagsTag` and
// `sharedSpeakerListsTag` in tags.ts all exist for this and each documents the read that
// forced it.

/**
 * How long a cached read may serve before Next revalidates it, in seconds.
 *
 * Two windows, because there are two kinds of data in this base, and the numbers are
 * the ones the `cacheLife` profiles this DAL used to name resolve to (`minutes`
 * revalidates at 60s, `hours` at 3600s, per node_modules/next/cache.d.ts). Keeping them
 * identical means dropping `cacheLife` did not quietly change how stale anything can
 * get, and the ceiling barely matters in practice anyway: every write expires the tags
 * it touched, so the window is only what covers a change made in Airtable directly.
 */
export const REVALIDATE = {
  /** Anything an organizer edits and then looks at. Was `cacheLife('minutes')`. */
  edited: 60,
  /** Lookup tables that change a handful of times per event. Was `cacheLife('hours')`. */
  lookup: 3_600,
} as const

/**
 * The cache half of one RequestInit.
 *
 * A write is `no-store` unconditionally, and that is the reason this decision is made
 * in one place rather than per call site: a cached write is a mutation that silently
 * did not happen, and an entry keyed on the request would answer the retry as well.
 *
 * A read with no window is `no-store` too, explicitly rather than by relying on
 * whatever Next's default happens to be. The write-path reads (`findReview`, the outbox
 * due-list, the round and assignment lookups) decide between create, update and skip
 * from their answer, and a cached answer there duplicates a row or sends an email
 * twice. "Uncached" therefore has to be a property of the request, not of a default
 * that a route segment config elsewhere could flip.
 */
export function cacheInit(kind: RequestKind, cache: ReadCache | undefined): RequestInit {
  if (kind === 'write' || cache?.revalidate === undefined) {
    return { cache: 'no-store' }
  }
  // Copied because Next's own `RequestInit` augmentation declares `tags` mutable.
  return { next: { revalidate: cache.revalidate, tags: [...(cache.tags ?? [])] } }
}
