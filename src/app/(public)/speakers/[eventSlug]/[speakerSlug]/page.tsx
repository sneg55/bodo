// A speaker's public permalink: /speakers/<event-slug>/<speaker-slug>.
//
// The address a speaker posts. Everything about the route follows from that: the OG tags below
// are the feature, the card underneath is what somebody sees after the preview persuaded them to
// click, and there is nothing here that a visitor has to be logged in for.
//
// THE 404 IS RESOLVED IN THE PAGE BODY, BEFORE THE FIRST BYTE, and there is deliberately no
// `loading.tsx` in this segment. A `notFound()` reached from inside a `<Suspense>` boundary
// renders the 404 body behind a 200 status line on Workers, because the status has already been
// sent by the time the boundary resolves, and a route-level `loading.tsx` IS such a boundary.
// Nothing in the test suite catches it: the page renders, nothing throws, and only the status line
// is wrong. Measured on the deployed Worker, and recorded in .claude/rules/bodo-conventions.md.
//
// Which means this page has no streaming shell to paint while the read runs, and that is the
// trade the rule forces. It is a cheap one here: three cached DAL calls, two of them in parallel,
// and a wrong permalink answering 200 would let an indexer accumulate a page per typo.
//
// The event header repeats the chrome of the event's own public site rather than inventing a
// second one, so a visitor who arrived on a speaker and then clicked through to the agenda does
// not appear to have landed on a different product.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { publicSitePath } from '@/features/cms/public-site'
import { EventBanner, EventLogo } from '@/features/settings/EventBrandHeader'
import { PublicSpeakerCard } from '@/features/speakers/PublicSpeakerCard'
import {
  absoluteUrl,
  readPublicSpeakerProfile,
  speakerMetaDescription,
} from '@/features/speakers/public-profile'
import { appUrl } from '@/utils/env'

type SpeakerParams = { eventSlug: string; speakerSlug: string }

/**
 * The unfurl. This is the point of the route, not decoration on it.
 *
 * Every URL is ABSOLUTE, built from `appUrl()`. A scraper fetching this page has no base to
 * resolve a relative `og:image` or `og:url` against, and it drops what it cannot resolve silently
 * rather than reporting it, so a relative value looks exactly like a missing one.
 *
 * `og:url` is the CANONICAL slug rather than the one the visitor typed, so a link that arrived
 * with odd casing still folds into one address for anything that de-duplicates by URL.
 *
 * A speaker with no headshot gets no `openGraph.images` at all rather than a placeholder. Most
 * scrapers fall back to the site's own card, which is a better preview than a grey avatar.
 *
 * Resolving the profile here costs no second round trip: the page body below makes the same DAL
 * calls, and they are served from the request's cache.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<SpeakerParams>
}): Promise<Metadata> {
  const { eventSlug, speakerSlug } = await params
  const profile = await readPublicSpeakerProfile(eventSlug, speakerSlug)
  // No title for a page that is about to answer 404. Naming an event on a tab whose body refuses
  // to say anything about that event would be the wrong kind of confident.
  if (profile === undefined) return {}

  const origin = appUrl()
  const title = `${profile.speaker.name} - ${profile.event.name}`
  const description = speakerMetaDescription(profile)
  const url = `${origin}/speakers/${encodeURIComponent(eventSlug)}/${profile.slug}`
  const image =
    profile.speaker.headshotUrl === undefined
      ? undefined
      : absoluteUrl(profile.speaker.headshotUrl, origin)

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      siteName: profile.event.name,
      ...(image === undefined ? {} : { images: [{ url: image, alt: profile.speaker.name }] }),
    },
    // `summary_large_image` only when there IS a large image; the plain summary card is what a
    // headshot-less profile should render, not a big empty box. Built as two whole objects rather
    // than one with a computed `card`, because `Twitter` is a union discriminated on that field
    // and a `'summary' | 'summary_large_image'` in it matches neither member.
    twitter:
      image === undefined
        ? { card: 'summary', title, description }
        : { card: 'summary_large_image', title, description, images: [image] },
  }
}

export default async function PublicSpeakerPage({ params }: { params: Promise<SpeakerParams> }) {
  const { eventSlug, speakerSlug } = await params
  const profile = await readPublicSpeakerProfile(eventSlug, speakerSlug)
  if (profile === undefined) notFound()

  return (
    <main className="min-h-screen bg-muted/40 p-4 sm:p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <EventBanner brand={profile.event}>
          <header className="flex items-center gap-3">
            <EventLogo brand={profile.event} />
            <span className="flex min-w-0 flex-col gap-1">
              <p className="text-balance font-heading text-xl font-semibold">
                {profile.event.name}
              </p>
              <p className="meta text-pretty text-muted-foreground">
                {profile.event.location === undefined
                  ? 'Speaker'
                  : `Speaker · ${profile.event.location}`}
              </p>
            </span>
          </header>
        </EventBanner>

        <PublicSpeakerCard speaker={profile.speaker} sessions={profile.sessions} />

        {/* The way back into the event's own site. A permalink is usually the first page of this
            event a visitor has ever seen, so leaving them on a dead end wastes the arrival. */}
        <nav aria-label="Event pages" className="flex flex-wrap items-center gap-1">
          <ButtonLink size="sm" variant="ghost" href={publicSitePath(profile.event.slug, '')}>
            Agenda
          </ButtonLink>
          <ButtonLink
            size="sm"
            variant="ghost"
            href={publicSitePath(profile.event.slug, 'speakers')}
          >
            All speakers
          </ButtonLink>
        </nav>
      </div>
    </main>
  )
}
