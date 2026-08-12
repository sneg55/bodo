// Root-level shortcuts to the public event site: /sessions, /speakers, /schedule, /gallery,
// /program, /explore, /itinerary and the rest of the spellings people actually try.
//
// WHY THEY EXIST. An eval run walked the deployment logged out and recorded that `/sessions`,
// `/speakers`, `/gallery`, `/schedule`, `/itinerary`, `/program`, `/explore` and `/embeds` all
// answered the app's 404 page, so the only public surface anybody could find was
// `/agenda/<slug>`, and only if they already knew the slug. A conference programme that requires
// knowing a slug is not published.
//
// THEY REDIRECT AND DO NOT RENDER, so every surface still has exactly one address for a visitor
// to bookmark and an indexer to settle on. The destination is the deployment's configured event
// (`portalEventId`), which is the same "the event this deployment serves" the speaker portal has
// always used; a deployment carrying several events keeps `/agenda/<slug>/...` as the address
// that names which one.
//
// A DYNAMIC SEGMENT RATHER THAN EIGHT FILES, and the risk that carries is answered rather than
// accepted: a root-level `[surface]` matches every single-segment path, so anything that is not
// a known spelling MUST `notFound()` here or every mistyped URL in the app starts answering 200.
// It does, in the page BODY, and this segment deliberately has no `loading.tsx`, because a
// route-level `loading.tsx` is a `<Suspense>` boundary and a `notFound()` below one renders the
// 404 body behind a 200 status line. Static routes still win: `/login`, `/submit`, `/agenda`,
// `/embed`, `/admin` and `/portal` are all literal segments and are matched before this.

import { notFound, redirect } from 'next/navigation'

import { canonicalSurfaceSegment, publicSitePath } from '@/features/cms/public-site'
import { portalEventId } from '@/features/portal/event-scope'
import { getEvent } from '@/services/airtable/queries'

export default async function PublicSurfaceShortcut({
  params,
}: {
  params: Promise<{ surface: string }>
}) {
  const { surface } = await params
  const canonical = canonicalSurfaceSegment(surface)
  if (canonical === undefined) notFound()

  const slug = await featuredEventSlug()
  if (slug === undefined) notFound()

  redirect(publicSitePath(slug, canonical))
}

/**
 * The slug of the event this deployment serves.
 *
 * `undefined` when `PORTAL_EVENT_ID` is unset or names a record that is gone, and the caller
 * turns that into a 404: a shortcut with nothing to point at is a URL that does not exist, which
 * is exactly what it was before this file. `portalEventId` throws in that case rather than
 * returning, which is why this is wrapped.
 */
async function featuredEventSlug(): Promise<string | undefined> {
  try {
    return (await getEvent(portalEventId())).slug
  } catch {
    return undefined
  }
}
