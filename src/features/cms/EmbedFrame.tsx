// The chrome around a served embed: ref 33's header band and its "Powered by" footer.
//
// Two things are transcribed off ref 33's preview and one is deliberately not. Transcribed: a
// coloured header band carrying the event title, and a footer line. Not transcribed: the wording
// of the footer, which reads "Powered by SESSIONBOARD" in the reference and reads "Powered by
// bodo" here, because the parity docs govern layout and control inventory and not whose product
// this is. It links home so a visitor on a third-party page can find out what rendered the feed.
//
// The band uses the theme's `primary` token rather than the reference's literal blue. The point
// of the token layer is that bodo's palette differs while the layout matches, and a hardcoded
// `bg-blue-600` also breaks in dark mode.
//
// A server component with no interactivity, which is the whole design of the served embed: no
// client bundle runs inside somebody else's page, so there is nothing of ours to conflict with
// their scripts and nothing to hydrate.

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import type { EmbedProjection } from '@/features/cms/projection'

export function EmbedFrame({
  projection,
  children,
}: {
  projection: EmbedProjection
  children: ReactNode
}) {
  return (
    // The WRAPPER carries both Style Options. `dark` has to sit on an ANCESTOR, because
    // src/app/globals.css declares `@custom-variant dark (&:is(.dark *))`: on the element itself it
    // would restyle the children and not the element. The two custom properties are set here for a
    // different reason: `--primary` and `--primary-foreground` are what `bg-primary` and
    // `text-primary-foreground` resolve to, so overriding the pair recolours everything in the
    // embed that uses the token rather than one hardcoded band.
    <div className={projection.theme === 'dark' ? 'dark' : undefined} style={projection.styleVars}>
      {/* `Extra CSS Code`, ALREADY SANITIZED. `mapCmsEmbed` ran it through `safeStoredEmbedCss` at
          the DAL read boundary, which is the only placement that also covers a value typed straight
          into the Airtable cell (@/features/cms/safe-css). Nothing is sanitized here, deliberately:
          a second call at the sink would suggest the read boundary is not the guarantee. Omitted
          entirely when there is none, rather than emitting an empty style element on every
          request. */}
      {projection.extraCss === undefined ? null : (
        <style dangerouslySetInnerHTML={{ __html: projection.extraCss }} />
      )}
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="flex flex-wrap items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
          <h1 className="min-w-0 flex-1 truncate font-heading text-base font-semibold">
            {projection.eventName}
          </h1>
          {/* The deep link, made visible. A visitor who followed a link to one speaker's sessions
              should be able to tell that they are looking at a filtered feed rather than at an
              event with one talk on it. */}
          {projection.focus === undefined ? null : (
            <Badge variant="secondary">{projection.focus}</Badge>
          )}
        </header>

        <main className="min-w-0 flex-1 p-4">{children}</main>

        <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          Powered by{' '}
          {/* `target="_blank"`, because this markup renders inside an iframe on somebody else's
              page: navigating in place would replace the feed with our home page inside their
              layout, which is a hijacked panel rather than a link. */}
          <Link
            className="font-medium underline-offset-4 hover:underline"
            href="/"
            target="_blank"
            rel="noreferrer"
          >
            bodo
          </Link>
        </footer>
      </div>
    </div>
  )
}

/**
 * What an embed shows when its view has nothing in it.
 *
 * Deliberately not blank. An embed sits inside a page an organizer does not own, so an empty
 * region reads as a broken integration; a sentence reads as an event whose agenda is not out
 * yet. The copy follows the public agenda's own empty state rather than inventing a second
 * voice for the same situation.
 */
export function EmbedEmptyState({ view }: { view: string }) {
  return (
    <p className="text-pretty py-6 text-center text-sm text-muted-foreground">
      {view === 'speaker_list' || view === 'speaker_gallery'
        ? 'The speaker lineup for this event has not been published yet. Check back soon.'
        : 'The agenda for this event has not been published yet. Check back soon.'}
    </p>
  )
}
