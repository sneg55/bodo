// The three blocks every session surface draws: speakers, badges, abstract. R9.
//
// Split out of EmbedViews.tsx because all three are now shared by four surfaces (the Session
// List card, the Agenda row, the Schedule Itinerary row and the detail dialog) and because that
// file has a 300-line budget. One copy is the point: a review of the public widgets found the
// same two defects on three surfaces at once (speakers as bare names, no Format anywhere), which
// is what three near-copies of a card produce.
//
// Server components, all of them. Only the abstract's expand control is a client island, and it
// is imported rather than inlined so nothing else here ships to the browser.

import { MapPinIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { EmbedSessionAbstract } from '@/features/cms/EmbedSessionAbstract'
import type { EmbedSession } from '@/features/cms/projection-days'

export type EmbedFieldSet = ReadonlySet<string>

/**
 * `Ada Okafor · Principal Engineer · Latticework Systems`, one speaker per line.
 *
 * The job title and the company are what a conference programme prints beside a name, and their
 * absence was a named gap on both the sessions list and the itinerary. A speaker record carrying
 * neither prints their name alone rather than a trailing separator, and a session whose rows
 * predate the richer projection falls back to the bare `speakers` array so no card goes blank.
 */
export function SessionSpeakers({
  session,
  fields,
}: {
  session: EmbedSession
  fields: EmbedFieldSet
}) {
  if (!fields.has('speakers')) return null
  if (session.people.length === 0) {
    if (session.speakers.length === 0) return null
    return (
      <p className="text-pretty text-sm text-muted-foreground">{session.speakers.join(', ')}</p>
    )
  }

  return (
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
  )
}

/**
 * Track, Room and Format, as chips.
 *
 * FORMAT IS RENDERED FROM WHATEVER THE RECORD CARRIES and is never invented: a submission with no
 * Format has no `format` on its projected session, so no chip appears. Its label comes from
 * @/features/cms/choice-label, the same function the organizer's own Filters panel uses, so the
 * chip and the visitor's Format facet read identically and can select each other.
 */
export function SessionBadges({
  session,
  fields,
}: {
  session: EmbedSession
  fields: EmbedFieldSet
}) {
  const track = fields.has('track') ? session.track : undefined
  const room = fields.has('room') ? session.room : undefined
  const format = fields.has('format') ? session.format : undefined
  if (track === undefined && room === undefined && format === undefined) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
      {track === undefined ? null : <Badge variant="secondary">{track}</Badge>}
      {room === undefined ? null : (
        <Badge variant="outline">
          <MapPinIcon data-icon="inline-start" />
          {room}
        </Badge>
      )}
      {format === undefined ? null : <Badge variant="outline">{format}</Badge>}
    </div>
  )
}

/**
 * The abstract, clamped to three lines with an in-place `Show more`.
 *
 * CLAMPED IN CSS rather than truncated in the model, which is why the projection carries the
 * whole string. Cutting it server side would have to guess a width, would break mid-word at
 * every viewport, and would leave the detail dialog holding a text that had already lost its
 * ending.
 */
export function SessionDescription({
  session,
  fields,
}: {
  session: EmbedSession
  fields: EmbedFieldSet
}) {
  if (!fields.has('description') || session.description === undefined) return null
  return <EmbedSessionAbstract description={session.description} />
}
