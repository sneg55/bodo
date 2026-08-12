// The one card the public permalink renders: headshot, name, role, links, biography, sessions.
//
// A SERVER component with no state of its own, which is the reason it can exist as a card rather
// than as the dialog the embed gallery uses (@/features/cms/EmbedSpeakerDetail). That dialog is a
// client component because it renders inside somebody else's iframe and navigating the frame would
// strand the visitor; this is a page of its own, so there is nothing to open and nothing to close.
//
// THE BIOGRAPHY RENDERS AS HTML AND THAT IS SAFE HERE, unlike in the embed dialog, whose header
// still says it must be text. What changed is `safeRichHtml`: `readPublicSpeakerProfile` sanitizes
// on the way out of the READ, so `bioHtml` is already clean by the time it arrives and no
// sanitizer ships to the browser. A speaker writes their bio in TipTap, so refusing to render the
// markup means printing `<p>` tags at a visitor, which is what every public surface used to do.
//
// SESSIONS CARRY THEIR DAY, TIME AND ROOM. A list of bare titles under a headshot says which talks
// a person is giving and nothing about when to be where, which is the one thing a visitor who
// followed this link from a post is trying to find out.

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { SpeakerHtml } from '@/components/primitives/SpeakerHtml'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { PublicSpeaker, PublicSpeakerSession } from '@/features/speakers/public-profile'

export function PublicSpeakerCard({
  speaker,
  sessions,
}: {
  speaker: PublicSpeaker
  sessions: readonly PublicSpeakerSession[]
}) {
  const subtitle = [speaker.tagline, speaker.company]
    .filter((part) => part !== undefined)
    .join(' · ')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar className="size-24">
            {speaker.headshotUrl === undefined ? null : (
              <AvatarImage src={speaker.headshotUrl} alt={speaker.name} />
            )}
            <AvatarFallback className="font-heading text-2xl">{speaker.initials}</AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/* The h1 of the page. A speaker sharing this link expects their own name to be what
                the document is about, and it is what a screen reader announces first. */}
            <h1 className="text-balance font-heading text-2xl font-semibold">{speaker.name}</h1>
            {subtitle === '' ? null : (
              <p className="text-pretty text-muted-foreground">{subtitle}</p>
            )}
            <SpeakerLinks speaker={speaker} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {speaker.bioHtml === undefined ? (
          <p className="text-sm text-muted-foreground">No biography yet.</p>
        ) : (
          <SpeakerHtml html={speaker.bioHtml} className="text-sm" />
        )}

        <Separator />

        <section className="flex flex-col gap-3">
          <h2 className="meta text-muted-foreground">{sessionsHeading(sessions.length)}</h2>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions on the published schedule yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

/**
 * The speaker's own links, as buttons that go somewhere.
 *
 * `ButtonLink` rather than a styled anchor so the appearance comes from the one `cva` definition,
 * and `rel="noreferrer"` on every one: these are addresses a speaker typed into their own profile,
 * so the destination is not ours and the referrer is not the destination's business.
 *
 * A stored value nothing safe can be made of (`speakerLinkHref` refuses anything off http and
 * https) is shown as plain text rather than as a dead button, on the same reasoning the CRM
 * profile uses: a control that goes nowhere is worse than a string.
 */
function SpeakerLinks({ speaker }: { speaker: PublicSpeaker }) {
  if (speaker.links.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {speaker.links.map((link) =>
        link.href === undefined ? (
          <span key={link.label} className="text-sm text-muted-foreground">
            {link.text}
          </span>
        ) : (
          <ButtonLink
            key={link.label}
            href={link.href}
            size="sm"
            variant="outline"
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </ButtonLink>
        ),
      )}
    </div>
  )
}

/** One session: what it is on the first line, when and where on the second. */
function SessionRow({ session }: { session: PublicSpeakerSession }) {
  const when = [session.day, session.time, session.room]
    .filter((part) => part !== undefined)
    .join(' · ')

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <span className="font-medium">{session.title}</span>
      {/* An unscheduled session says so rather than showing an empty line: the schedule is
          published, so a blank where a time belongs reads as a page that failed to load one. */}
      <span className="meta text-muted-foreground">
        {when === '' ? 'Time to be confirmed' : when}
      </span>
    </li>
  )
}

function sessionsHeading(count: number): string {
  return count === 0 ? 'Sessions' : `Sessions (${count})`
}
