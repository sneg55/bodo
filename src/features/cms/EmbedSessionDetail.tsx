'use client'

// The session detail a card or an agenda block opens. R9, EMB-08.
//
// A `Dialog` for the reason `EmbedSpeakerDetail` gives: this renders in an iframe on somebody
// else's page, so navigating the frame to a detail route would strand the visitor in a
// sub-page of a widget the host page cannot navigate back from.
//
// It shows the FULL abstract, where the card clamps it to three lines. That is the whole
// point of carrying the untruncated string through the projection: a card that cuts a text
// and a detail that cannot show the rest is a dead end.
//
// It renders its child unchanged when there is no provider, so the editor's preview panel
// draws exactly the markup it always did. Same escape hatch as the other three islands.

import { MapPinIcon } from 'lucide-react'

import { SpeakerHtml } from '@/components/primitives/SpeakerHtml'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useEmbedViewState } from '@/features/cms/EmbedViewState'
import type { EmbedSession } from '@/features/cms/projection-days'
import { cn } from '@/utils/cn'

export function EmbedSessionDetail({
  session,
  /** Pre-formatted, in the event's timezone and the organizer's chosen format. */
  timeLabel,
  children,
  className,
}: {
  session: EmbedSession
  timeLabel?: string
  children: React.ReactNode
  className?: string
}) {
  const state = useEmbedViewState()
  if (state === undefined) return children

  return (
    <Dialog>
      {/* `render` rather than a wrapping <button>: the trigger contains a Card or a row of
          block elements, and in the itinerary it contains the schedule star, which IS a
          button. Nesting one button inside another is invalid markup browsers reflow
          unpredictably. Focus ring and keyboard activation are kept.

          `role` and `aria-label` are spelled out because the div does not otherwise say what
          it is. To anything reading the accessibility tree rather than the pixels, an
          agenda of clickable cards looked like an agenda of plain text: a review of the
          public embeds concluded "no card in any of the five widgets is clickable to a
          detail view" while every card opened a dialog on click. A visitor using a screen
          reader was told exactly as little. */}
      <DialogTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            aria-label={`${session.title} — open details`}
            className={cn(
              // `plain-label`: this trigger is not a chrome button, it is the whole card.
              // globals.css gives every `[data-slot="dialog-trigger"]` the machine-label
              // treatment, and `text-transform` and `letter-spacing` INHERIT, so the session
              // title, the speaker names and the abstract underneath all rendered uppercase
              // mono. Uppercasing a talk somebody submitted is not the same as uppercasing
              // Filters.
              'plain-label w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          />
        }
      >
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left text-pretty">{session.title}</DialogTitle>
          {/* The full start-to-end range, which is what the rubric asks a detail to add over
              a card. Already formatted upstream: Workers run `Intl` in UTC, so composing a
              time here would show every visitor the wrong hour. */}
          {timeLabel === undefined ? null : (
            <DialogDescription className="text-left tabular-nums">{timeLabel}</DialogDescription>
          )}
        </DialogHeader>

        {/* Named with their job title and company, not as a comma-joined string of names. That
            is what a programme prints beside a speaker, and it was missing from every public
            surface at once. A speaker record carrying neither prints their name alone. */}
        {session.people.length === 0 ? (
          session.speakers.length === 0 ? null : (
            <p className="text-pretty text-sm text-muted-foreground">
              {session.speakers.join(', ')}
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            {session.people.map((person) => (
              <li key={person.id} className="text-pretty">
                <span className="text-foreground">{person.name}</span>
                {[person.tagline, person.company]
                  .filter((part) => part !== undefined)
                  .map((part) => ` · ${part}`)
                  .join('')}
              </li>
            ))}
          </ul>
        )}

        {/* Track, Room and FORMAT. Format is rendered from whatever the submission carries and is
            never invented: a row with none simply has no chip. It was absent from every public
            surface, which is what EMB-08 named on this dialog. */}
        {session.track === undefined &&
        session.room === undefined &&
        session.format === undefined ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            {session.track === undefined ? null : (
              <Badge variant="secondary">{session.track}</Badge>
            )}
            {session.room === undefined ? null : (
              <Badge variant="outline">
                <MapPinIcon data-icon="inline-start" />
                {session.room}
              </Badge>
            )}
            {session.format === undefined ? null : (
              <Badge variant="outline">{session.format}</Badge>
            )}
          </div>
        )}

        {/* Unclamped here, and rendered as HTML. It was rendered as TEXT, on the grounds that
            this is speaker-authored markup and the codebase had no sanitizer; there is one now,
            and `describeSessions` calls it on the SERVER, so what arrives here is already clean.
            What the old rule actually produced on a page belonging to the conference was a
            detail modal printing `<p>Sharding, caching, and the failure modes.</p>` verbatim. */}
        {session.description === undefined ? null : (
          <SpeakerHtml html={session.description} className="text-pretty text-sm" />
        )}
      </DialogContent>
    </Dialog>
  )
}
