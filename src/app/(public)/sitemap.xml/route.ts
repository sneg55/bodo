// /sitemap.xml: the machine-readable half of "the public pages are discoverable".
//
// It answered 404, which for a conference programme is the difference between being on the web
// and being on a URL somebody has to be told. Five surfaces exist per event and none of them was
// listed anywhere a crawler could reach.
//
// A ROUTE HANDLER rather than Next's `app/sitemap.ts` convention, for one reason: the convention
// file sits at the app root, and this deployment's public routes live in the `(public)` group.
// A route group does not appear in the URL, so `(public)/sitemap.xml/route.ts` serves exactly
// `/sitemap.xml` while keeping the file beside the pages it describes.
//
// It lists the deployment's configured event only (`portalEventId`), not every event in the base.
// That is deliberate and it is a disclosure decision rather than a shortcut: enumerating the
// whole `Events` table would publish the existence and slug of every conference an organizer has
// drafted, including ones with nothing published, to anyone who asked for one static file.
//
// An unresolvable event yields an EMPTY urlset and still answers 200. A 404 or a 500 here reads
// to a crawler as a broken site to retry; an empty sitemap reads as a site with nothing to index
// yet, which is what a deployment with no configured event actually is.

import { PUBLIC_SITE_SURFACES, publicSitePath } from '@/features/cms/public-site'
import { portalEventId } from '@/features/portal/event-scope'
import { getEvent } from '@/services/airtable/queries'

/** How long a crawler and the CDN may hold this. A schedule changes on the order of hours. */
const CACHE_SECONDS = 3_600

export async function GET(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin
  const paths = await publicPaths()

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${xmlText(origin + path)}</loc></url>`).join('\n')}
</urlset>
`

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    },
  })
}

async function publicPaths(): Promise<readonly string[]> {
  try {
    const event = await getEvent(portalEventId())
    return PUBLIC_SITE_SURFACES.map((surface) => publicSitePath(event.slug, surface.segment))
  } catch {
    return []
  }
}

/**
 * The five characters XML requires escaped inside an element.
 *
 * A slug is minted from an event name, so an ampersand in `Rust & Wasm Day` is a real value and
 * not a hypothetical: unescaped it produces a document no parser will accept, which is a silently
 * dead sitemap rather than a visible error.
 */
function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
