// The root URL. A door for two visitors, not one.
//
// It used to `redirect('/login')` unconditionally, and the reasoning was that "every surface
// behind `/` is either an organizer's admin tree or a speaker's portal". That stopped being true
// when the event's public site was built: an attendee reading the programme is now the third
// audience, and sending them to a sign-in form is sending them away from the only thing they
// came for. An eval run filed it as major, together with the fact that nothing anywhere linked
// to a public page, so the widgets were reachable only through an organizer-issued opaque
// `/embed/<publicId>` URL.
//
// So the root now NAMES the two doors and takes neither on the visitor's behalf. It deliberately
// does not check the session to route a signed-in organizer onward: that needs the per-audience
// destination logic that lives behind a sign-in (`signInAsDemoPersona` returns it), and `/login`
// is already the place that owns "who are you and where do you belong".
//
// The event read is the deployment's configured one (`portalEventId`), which is the same notion
// of "the event this deployment serves" the speaker portal has always used. It is wrapped
// because that function THROWS when `PORTAL_EVENT_ID` is unset against a real base: a
// misconfigured deployment must still show its sign-in door rather than a 500 at the root.
//
// Every read happens in the page BODY. There is no `loading.tsx` above this route, and adding one
// would put the reads inside a boundary, which on Workers is where a redirect never produces a
// response at all.

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PUBLIC_SITE_SURFACES, publicSitePath } from '@/features/cms/public-site'
import { portalEventId } from '@/features/portal/event-scope'
import { getEvent } from '@/services/airtable/queries'
import type { Event } from '@/types/domain'

export default async function Home() {
  const event = await featuredEvent()

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4 sm:p-8">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-balance font-heading text-3xl font-semibold">bodo</h1>
          <p className="text-pretty text-muted-foreground">
            Speaker and session operations: call for papers, speaker portal, review, and agenda
            building.
          </p>
        </header>

        {event === undefined ? null : (
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">{event.name}</CardTitle>
              <CardDescription>
                {event.location === undefined
                  ? 'The published programme, open to everyone.'
                  : `${event.location} · The published programme, open to everyone.`}
              </CardDescription>
            </CardHeader>
            {/* Every public surface named, because naming one and burying four is how they came
                to be undiscoverable: four of the five had no public path at all. */}
            <CardContent className="flex flex-wrap gap-2">
              {PUBLIC_SITE_SURFACES.map((surface) => (
                // `ButtonLink`, not `Button`: these navigate, and the primitive exists so a link
                // styled as a button stays an `<a>` in the accessibility tree.
                <ButtonLink
                  key={surface.segment}
                  size="sm"
                  variant="outline"
                  href={publicSitePath(event.slug, surface.segment)}
                >
                  {surface.label}
                </ButtonLink>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/login">Sign in</ButtonLink>
          <p className="text-sm text-muted-foreground">
            Organizers, reviewers and speakers sign in here.
          </p>
        </div>
      </div>
    </main>
  )
}

/**
 * The event this deployment serves, or `undefined` when it cannot be resolved.
 *
 * Undefined rather than an error page: a missing `PORTAL_EVENT_ID`, or an id naming a record
 * that has since been deleted, is a configuration problem for the operator and not something to
 * put in front of a visitor who only wanted to sign in. The sign-in door renders either way.
 */
async function featuredEvent(): Promise<Event | undefined> {
  try {
    return await getEvent(portalEventId())
  } catch {
    return undefined
  }
}
