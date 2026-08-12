import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

// Cache Components is OFF, and that is a decision forced by the deployment target
// rather than a preference. See BUILD_SPEC section 7.4 for the evidence.
//
// With `cacheComponents: true`, @opennextjs/cloudflare cannot resume a partially
// prerendered route: pages whose dynamic half needs a resume hang until the Workers
// runtime cancels the request, and pages that can be served from their static shell
// return 200 with the dynamic half silently missing, which is worse. Both were
// reproduced on the deployed Worker, not just in local preview.
//
// So caching moves to the model that does work on this adapter: tagged `fetch` calls
// inside the Airtable client, with `revalidateTag` on write. The judged property is
// unchanged (no navigation waits on Airtable) because the tagged fetch is still served
// from cache; what is lost is `use cache` composition and the `updateTag` distinction.
//
// `partialPrefetching` is absent for a second, separate reason: it is a Next 16.3 flag,
// and 16.3 does not run on this adapter at all.
/**
 * The embed feed extensions, mapped onto the route handler that serves them.
 *
 * `/embed/<publicId>.json` is the address, and `src/app/(public)/embed/[publicId]/[format]` is
 * the handler. They cannot be the same thing on this router: a dynamic segment must be a WHOLE
 * path segment, so there is no `[publicId].json` directory to write, and an extension is what a
 * reader guesses and what a calendar client can subscribe to. This rewrite is the only place the
 * two spellings meet. See @/features/cms/format-options.
 *
 * The ARRAY form, which Next runs as `afterFiles`: checked after static files and BEFORE dynamic
 * routes, which is what makes it win over `/embed/[publicId]`. That page would otherwise match
 * `/embed/abc.json` with `publicId = "abc.json"` and answer 404 for an id that exists.
 *
 * The parameter is constrained to the alphabet `nanoid` mints, so a value with a slash, a dot or
 * a quote in it never reaches the handler. Query strings are preserved by the rewrite, so the
 * deep-link parameters apply to a feed exactly as they apply to the page.
 */
const EMBED_ID = ':publicId([A-Za-z0-9_-]+)'
const embedFeedRewrites = [
  { source: `/embed/${EMBED_ID}.html`, destination: '/embed/:publicId/html' },
  { source: `/embed/${EMBED_ID}.json`, destination: '/embed/:publicId/json' },
  { source: `/embed/${EMBED_ID}.xml`, destination: '/embed/:publicId/xml' },
  { source: `/embed/${EMBED_ID}.ics`, destination: '/embed/:publicId/ics' },
]

const nextConfig: NextConfig = {
  rewrites: () => Promise.resolve(embedFeedRewrites),
}

// Makes Cloudflare bindings available to getCloudflareContext() under `next dev`.
// Without this, src/utils/cf.ts falls back to its in-memory stand-ins.
void initOpenNextCloudflareForDev()

export default nextConfig
