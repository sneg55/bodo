'use client'

// The speaker detail a list entry or a gallery card opens. R9.
//
// A `Dialog` and not a route, and that is forced rather than chosen: this renders inside an
// iframe on somebody else's website, so navigating the frame to a detail page would leave the
// visitor stranded in a sub-page of a widget with no way back that the host page understands.
// A dialog keeps the whole interaction inside the box the organizer embedded.
//
// The ONE client component in the embed's render path. Everything else the frame draws is a
// server component, and it stays that way: this takes an already-projected `EmbedSpeaker`,
// so no read, no formatting and no visibility rule crosses into the browser. What ships is the
// open/closed state and nothing else.
//
// The biography renders as HTML, through `SpeakerHtml`. It used to render as TEXT, and the
// comment here said why: speaker-authored markup with no sanitizer in this codebase. There is a
// sanitizer now (src/utils/safe-html.ts) and `embedSpeakers` calls it on the way out of the read,
// so what arrives is already clean. What the old rule actually bought was the modal printing
// `<p>Priya Raman is a Principal Engineer ... </p>` on a page belonging to the conference.
//
// Do not add a sanitize call here. This is a client component, so it would ship the parser into
// the embed chunk and leave the raw markup in the RSC payload regardless. See `SpeakerHtml`.

import { SpeakerHtml } from '@/components/primitives/SpeakerHtml'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmbedSpeakerSessions, embedSessionsHeading } from '@/features/cms/EmbedSpeakerSessions'
import type { EmbedSpeaker } from '@/features/cms/speakers'
import { cn } from '@/utils/cn'

export type EmbedSpeakerDetailProps = {
  speaker: EmbedSpeaker
  fields: ReadonlySet<string>
  /** The card itself. It becomes the trigger, so the whole card is the hit area. */
  children: React.ReactNode
  className?: string
}

export function EmbedSpeakerDetail({
  speaker,
  fields,
  children,
  className,
}: EmbedSpeakerDetailProps) {
  const subtitle = [
    fields.has('tagline') ? speaker.tagline : undefined,
    fields.has('company') ? speaker.company : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')

  return (
    <Dialog>
      {/* `render` rather than a wrapping button: the card is already a block element, and
          nesting one inside a <button> is invalid markup that browsers reflow unpredictably.
          The trigger keeps its own focus ring and keyboard behaviour either way.

          `role` and `aria-label` are spelled out because the div does not otherwise say what
          it is. To anything reading the accessibility tree rather than the pixels, a gallery
          of clickable cards looked like a gallery of plain text, and a review of the public
          embeds concluded no card was clickable while every one of them opened this dialog.
          A visitor using a screen reader was told exactly as little. */}
      <DialogTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            aria-label={`${speaker.name} — open profile`}
            className={cn(
              // `plain-label`: this trigger is the whole speaker card, not a chrome button.
              // globals.css gives every `[data-slot="dialog-trigger"]` the machine-label
              // treatment, and `text-transform` and `letter-spacing` INHERIT, so the speaker's
              // name, job title and company all rendered uppercase mono inside it. A person's
              // name is their own text.
              'plain-label cursor-pointer rounded-xl text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
          />
        }
      >
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <Avatar className="size-14">
              {speaker.headshotUrl === undefined ? null : (
                <AvatarImage
                  src={speaker.headshotUrl}
                  alt={speaker.name}
                  // Same pure black/white outline the roster cards carry, so a headshot that
                  // meets the dialog background still has an edge.
                  className="outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
              )}
              <AvatarFallback>{speaker.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-left">{speaker.name}</DialogTitle>
              {subtitle === '' ? null : (
                <DialogDescription className="text-left">{subtitle}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* The bio is what the detail exists for, so its absence is stated rather than left as
            a gap the reader has to interpret. */}
        {fields.has('about') && speaker.bio !== undefined ? (
          <SpeakerHtml html={speaker.bio} className="text-pretty text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground">No biography yet.</p>
        )}

        {/* `Sessions (N)`, and each entry carries its date and its room. Titles alone were the
            named gap on both this dialog and the gallery card's. */}
        {speaker.sessions.length === 0 ? null : (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {embedSessionsHeading(speaker.sessions.length)}
            </p>
            <EmbedSpeakerSessions sessions={speaker.sessions} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
