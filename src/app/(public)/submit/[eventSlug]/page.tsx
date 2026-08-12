// The event's call for papers, at /submit/<event-slug>. The index the wizard never had.
//
// WHY IT EXISTS. Two eval agents independently reported that nothing anywhere links to the open
// call for papers, and there was nothing to link to: the only route under `/submit` was
// `[eventSlug]/[formPublicId]`, so `/submit` and `/submit/<slug>` both answered 404 and the
// wizard was reachable only by pasting the opaque per-form URL an organizer copies out of the
// builder. The headline feature of the product was undiscoverable, and a call for papers that a
// speaker cannot find is a call for papers that receives nothing.
//
// It lists the forms `publicFormGate` would actually open (@/features/cms/public-site), so this
// page and the wizard behind it cannot disagree: a draft form or one past its close date is
// absent here rather than listed and then refused on arrival.
//
// EVERY READ HAPPENS IN THIS BODY, and the `notFound()` with them. On Workers a `notFound()`
// reached from inside a `<Suspense>` boundary renders the 404 page after the 200 status line has
// already been flushed, so the response is HTTP 200 with a 404 body: measured on the deployed
// Worker and fixed on three other routes. There is deliberately NO `loading.tsx` beside this
// file for the same reason, because a route-level one is itself such a boundary. An unknown slug
// must answer a real 404.

import { notFound } from 'next/navigation'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PublicSiteNav } from '@/features/cms/PublicSiteNav'
import {
  openCalls,
  publicSitePath,
  SUBMIT_ACTIVE,
  submitIndexPath,
} from '@/features/cms/public-site'
import { EventBanner, EventLogo } from '@/features/settings/EventBrandHeader'
import { getEventBySlug, listForms } from '@/services/airtable/queries'

/**
 * `<event name> - Call for papers`, matching the wizard's own `<event name> - <form title>`.
 *
 * The event read is the same cached one the body makes below, so resolving it twice costs a
 * request-scoped cache hit rather than a second round trip. An unknown slug gets the generic
 * title and the body answers 404.
 */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params
  const event = await getEventBySlug(eventSlug)
  return { title: event === undefined ? 'Call for papers' : `${event.name} - Call for papers` }
}

export default async function CallForPapersPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const { eventSlug } = await params

  const event = await getEventBySlug(eventSlug)
  if (event === undefined) notFound()

  const calls = openCalls(await listForms(event.id), event, new Date())

  return (
    <main className="min-h-screen bg-muted/40 p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* The same banner, logo and nav the five reading surfaces wear, because this is a
            page of the same site and a speaker who lands here from a shared link should be
            able to reach the programme without editing the URL. */}
        <EventBanner brand={event}>
          <header className="flex items-center gap-3">
            <EventLogo brand={event} />
            <span className="flex min-w-0 flex-col gap-1">
              <h1 className="text-balance font-heading text-2xl font-semibold">{event.name}</h1>
              <p className="meta text-pretty text-muted-foreground">
                {event.location === undefined
                  ? 'Call for papers'
                  : `Call for papers · ${event.location}`}
              </p>
            </span>
          </header>
        </EventBanner>

        <PublicSiteNav
          eventSlug={event.slug}
          active={SUBMIT_ACTIVE}
          submitHref={submitIndexPath(event.slug)}
        />

        {calls.length === 0 ? (
          // Stated, not 404'd. The event is real and its programme is worth reading, so this
          // says what happened and offers the thing the visitor can still do. The wording is
          // the closed-form wizard's, so a speaker gets one answer rather than two.
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Submissions are closed</CardTitle>
              <CardDescription>
                This event is not accepting submissions right now. Contact the organizer if you
                think this is a mistake.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ButtonLink variant="outline" href={publicSitePath(event.slug, '')}>
                View the agenda
              </ButtonLink>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {calls.map((call) => (
              <Card key={call.publicId}>
                <CardHeader>
                  <CardTitle className="font-heading">{call.title}</CardTitle>
                  {call.deadlineLine === undefined ? null : (
                    <CardDescription>{call.deadlineLine}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {/* `ButtonLink` and not `Button`: this GOES somewhere, and the destination
                      resolves the form against Airtable, so the pending state it carries is
                      the difference between a slow control and one reported as dead. */}
                  <ButtonLink href={call.href}>Start submission</ButtonLink>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
