// OpenNext overrides for Cloudflare. See BUILD_SPEC section 7.2.
//
// Choices, and why:
//   incrementalCache  R2 under the regional cache. KV is documented as not
//                     recommended here because of eventual consistency, and a
//                     stale admin list right after an accept is precisely the bug
//                     that would produce.
//   tagCache          Durable Object sharded. Every write in this app revalidates
//                     tags, which is the load D1's tag cache is documented as
//                     unsuitable for.
//   queue             Durable Object queue, so concurrent revalidations dedupe.

import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import { withRegionalCache } from '@opennextjs/cloudflare/overrides/incremental-cache/regional-cache'
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue'
import doShardedTagCache from '@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache'

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: 'long-lived',
    shouldLazilyUpdateOnCacheHit: true,
  }),
  tagCache: doShardedTagCache({ baseShardSize: 4 }),
  queue: doQueue,
})
