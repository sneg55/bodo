// The chrome every page of the event's public site wears, and the body it streams behind it.
//
// Five surfaces share one shell so a visitor can move between them: before this, the schedule,
// the session list, the two speaker rosters and the itinerary each existed only as an embed
// behind an opaque `/embed/<publicId>` link, and the one public page that did exist linked to
// none of them. A nav that names all five is most of what "discoverable" means here.
//
// THE SPLIT IS THE ONE THE CONVENTIONS ALLOW. The event header is drawable from a single cached
// record read the route has already done; the surface behind it is four more DAL calls. Public
// routes have no `loading.tsx` to fall back on (and must not gain one: `notFound()` from inside
// a boundary answers 200 with the 404 body), so the header plus the nav is what a visitor sees
// while the schedule resolves.
//
// The event is handed in as a resolved record rather than a slug, because the route body has
// already had to resolve it in order to `notFound()` before the first byte.

import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import type { RawParams } from '@/features/cms/deep-link'
import { EmbedSurface } from '@/features/cms/EmbedSurface'
import { PublicSiteNav } from '@/features/cms/PublicSiteNav'
import { openCalls, type PublicSiteSurface, submitIndexPath } from '@/features/cms/public-site'
import { readPublicSiteSurface } from '@/features/cms/reads'
import { EventBanner, EventLogo } from '@/features/settings/EventBrandHeader'
import { listForms } from '@/services/airtable/queries'
import type { Event } from '@/types/domain'

export async function PublicSitePage({
  event,
  surface,
  params,
}: {
  event: Event
  surface: PublicSiteSurface
  /** The request's `searchParams`, already awaited by the route. Carries `sb-speaker-id`. */
  params: RawParams
}) {
  const hasOpenCall = await eventHasOpenCall(event)

  return (
    <main className="min-h-screen bg-muted/40 p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <EventBanner brand={event}>
          <header className="flex items-center gap-3">
            <EventLogo brand={event} />
            <span className="flex min-w-0 flex-col gap-1">
              <h1 className="text-balance font-heading text-2xl font-semibold">{event.name}</h1>
              {/* Mono and uppercase: it is a place and a section name, which is
                  exactly what the reference gives this treatment to. */}
              <p className="meta text-pretty text-muted-foreground">
                {event.location === undefined
                  ? surface.title
                  : `${surface.title} · ${event.location}`}
              </p>
            </span>
          </header>
        </EventBanner>

        <PublicSiteNav
          eventSlug={event.slug}
          active={surface.segment}
          submitHref={hasOpenCall ? submitIndexPath(event.slug) : undefined}
        />

        <Suspense fallback={<SurfaceSkeleton />}>
          <PublicSiteBody event={event} surface={surface} params={params} />
        </Suspense>
      </div>
    </main>
  )
}

/**
 * Does this event have a call for papers a stranger may open right now?
 *
 * IN THE SHELL, not behind the `<Suspense>` below, and that is worth the one extra read. The
 * call for papers is the only thing on this site a visitor can act on, and a link that appears
 * a second after the page paints is one they have already scrolled past. The read is
 * `listForms`, which is cached and tagged `event:{id}:forms`, so it costs a request-scoped
 * cache hit rather than an Airtable round trip on all but the first view.
 *
 * A failure answers "no open call" instead of propagating. This is the agenda, the session
 * list and the speaker gallery: a forms read that fails must not take the published programme
 * down with it, and the worst case is the button an organizer can still link to directly.
 */
async function eventHasOpenCall(event: Event): Promise<boolean> {
  try {
    return openCalls(await listForms(event.id), event, new Date()).length > 0
  } catch {
    return false
  }
}

/**
 * The half that waits on the schedule.
 *
 * Separate from the shell above because the shell renders it inside `<Suspense>`. It takes the
 * event record it was handed, so no `params` read hides in here.
 */
async function PublicSiteBody({
  event,
  surface,
  params,
}: {
  event: Event
  surface: PublicSiteSurface
  params: RawParams
}) {
  const projection = await readPublicSiteSurface({ event, view: surface.view, params })
  // `embedProjection` answers undefined for a DISABLED embed, and the event's own pages have no
  // switch to be off (@/features/cms/public-site). Rendering the empty state rather than
  // throwing, because this is inside a boundary: a `notFound()` here would answer 200 with the
  // 404 body, which is the defect the conventions file records against exactly this shape.
  if (projection === undefined) {
    return (
      <p className="text-pretty py-6 text-center text-sm text-muted-foreground">
        The agenda for this event has not been published yet. Check back soon.
      </p>
    )
  }

  // Keyed on the EVENT and not on the surface, so a visitor who stars three sessions on the
  // agenda still has them when they open My schedule. An embed keys on its own `publicId`
  // instead, which is what keeps two widgets on one host page apart.
  //
  // `personal` is the other half of that sentence: the surface table marks `My schedule` as the
  // visitor's own, and this is where that becomes the star filter starting on rather than the
  // whole programme with their picks behind a toggle. Read off the surface rather than compared
  // against a segment here, so one place says what each page is.
  return (
    <EmbedSurface
      projection={projection}
      stateKey={`site:${event.slug}`}
      personal={surface.personal === true}
    />
  )
}

function SurfaceSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  )
}
