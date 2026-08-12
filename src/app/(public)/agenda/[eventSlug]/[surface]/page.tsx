// The other four pages of the event's public site: /agenda/<slug>/sessions, /schedule,
// /speakers and /gallery.
//
// One route for four surfaces because they differ only in which layout the shared projection is
// asked for (@/features/cms/public-site). Four near-identical page files would be four places
// for a future field or control to be added to three of them.
//
// AN UNKNOWN SEGMENT IS A REAL 404, resolved in the page BODY before either read. Two reasons it
// has to be here and not in the shell below: on Workers a `notFound()` reached from inside a
// `<Suspense>` boundary renders the 404 body behind a 200 status line, and a segment that
// silently fell back to the agenda would give an indexer as many copies of the agenda as it
// could invent spellings.
//
// There is deliberately NO `loading.tsx` in this segment, for that same reason: a route-level
// `loading.tsx` is itself such a boundary and would defeat the `notFound()` below it. The shell
// renders its own `<Suspense>` around the part that waits on Airtable, which is a better
// fallback than a bare skeleton anyway because the header and the nav are already on screen.

import { notFound, redirect } from 'next/navigation'

import { PublicSitePage } from '@/features/cms/PublicSitePage'
import {
  canonicalSurfaceSegment,
  publicSitePath,
  publicSiteSurface,
} from '@/features/cms/public-site'
import { getEventBySlug } from '@/services/airtable/queries'

/**
 * The tab title names the surface, not the route.
 *
 * Four pages sharing one file would otherwise share one `<title>`, and a visitor with the
 * agenda, the sessions list and the gallery open would have three tabs reading `Agenda`.
 * An unknown segment gets no title: the page below it answers 404.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ surface: string }>
}): Promise<{ title?: string }> {
  const { surface } = await params
  const resolved = publicSiteSurface(surface)
  return resolved === undefined ? {} : { title: resolved.title }
}

export default async function PublicSurfacePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string; surface: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ eventSlug, surface: segment }, query] = await Promise.all([params, searchParams])

  const canonical = canonicalSurfaceSegment(segment)
  if (canonical === undefined) notFound()
  // An alias (`itinerary`, `program`, `talks`) redirects to the one address that renders it,
  // rather than serving the same page twice. In the BODY, outside any boundary, for the reason
  // `notFound()` is: a redirect resolved after the shell has flushed never produces a response
  // and the Workers runtime cancels the request.
  if (canonical !== segment) redirect(publicSitePath(eventSlug, canonical))

  const surface = publicSiteSurface(canonical)
  if (surface === undefined) notFound()

  const event = await getEventBySlug(eventSlug)
  if (event === undefined) notFound()

  return <PublicSitePage event={event} surface={surface} params={query} />
}
