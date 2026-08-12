// The speaker roster the Speaker List and Speaker Gallery views render. R9.
//
// The important thing about this function is where its input comes from, not what it does. It
// is fed the rows that `publicAgendaRows` has already accepted, and never the event's Speakers
// table, because those are two different sets of people: `listSpeakers(eventId)` returns every
// speaker record on the event, including the ones whose submissions were rejected, withdrawn or
// are still pending review. A gallery built from that table would publish the fact that a named
// person applied and was turned down, to a page on somebody else's website.
//
// So a speaker appears here only via an accepted, published, uncancelled session, which is
// exactly the rule the public agenda already enforces (@/features/agenda/public-agenda). Losing
// their last session is what removes them, and there is no second visibility rule to keep in
// step with the first.
//
// The ordering and the fields are AUTHORED. Ref 33 shows no speaker view at all (only an empty
// Agenda header band), so docs/parity/cms-embeds.md records the rendered markup of all five
// views as an ambiguity.
//
// SORTED BY SURNAME, not by display name. It used to sort on `name`, which is
// "First Last", so the roster read Ada, Bruno, Chen, Gita, Priya: alphabetical by given
// name, which is not what a conference programme means by an alphabetical speaker list and
// is not what a reader scanning for someone will do. `firstName` breaks the tie, and the id
// breaks that, so the order is total and cannot reshuffle between reads.
//
// The BIOGRAPHY is now carried, and that is a deliberate reversal of the note this comment
// used to end with. It was excluded alongside the email and the phone, but those are contact
// details and a bio is published copy: it is what a speaker writes FOR the programme, and a
// speaker detail with no bio is a card with a photo and a job title. The email and the phone
// stay out.
//
// THE BIOGRAPHY IS MARKUP AND IT IS SANITIZED HERE. A speaker writes it in TipTap, so the column
// stores HTML, and every roster surface printed it as text: the modal a list row and a gallery
// card open read `<p>Priya Raman is a Principal Engineer ... </p>`, tags and all, on a page
// belonging to the conference. Sanitizing on the way out of the READ rather than at the sink is
// the rule src/utils/safe-html.ts states and `describeSessions` already follows for the session
// abstract, and it is what keeps `htmlparser2` out of the embed's client chunk while still
// putting clean markup in the RSC payload.
//
// Which is also why nothing a CLIENT component needs at runtime may live in this file any more.
// The roster's name matcher used to, and it moved to ./EmbedSpeakerBrowse for exactly that
// reason; what crosses from here is a TYPE, which is erased.
//
// A SPEAKER'S SESSION SUBLIST CARRIES ITS DATE AND ROOM, not just its title. A list of bare
// titles under a headshot tells a visitor which talks a person is giving and nothing about
// when to be where, which is the one thing they opened the profile to find out. The date and
// the room are not recomputed here: they arrive as the SAME pre-formatted strings the session
// card printed (@/features/cms/projection-days), so a profile and a card cannot disagree.

import type { EmbedSessionSlot } from '@/features/cms/projection-days'
import { speakerInitials } from '@/features/speakers/initials'
import { htmlToText } from '@/utils/html-text'
import { safeRichHtml } from '@/utils/safe-html'

export type EmbedSpeakerSource = {
  id: string
  firstName: string
  lastName: string
  tagline?: string
  company?: string
  headshotUrl?: string
  bio?: string
}

export type EmbedSpeakerRow = {
  id: string
  title: string
  participants: readonly { speaker: EmbedSpeakerSource }[]
}

/** One line of a speaker's session sublist. */
export type EmbedSpeakerSession = {
  id: string
  title: string
  /** The date, pre-formatted in the event's timezone and the organizer's chosen format. */
  when?: string
  room?: string
}

export type EmbedSpeaker = {
  id: string
  name: string
  /** For the gallery's avatar when there is no headshot. */
  initials: string
  tagline?: string
  company?: string
  headshotUrl?: string
  /**
   * Published copy, shown in the detail a card opens. Never the email or the phone.
   *
   * SANITIZED HTML, not text: the column stores markup and `bioOf` runs it through
   * `safeRichHtml`, so a renderer passes it to `SpeakerHtml` and never escapes it.
   */
  bio?: string
  /** This speaker's public sessions, in schedule order, each with its date and room. */
  sessions: readonly EmbedSpeakerSession[]
}

export function embedSpeakers(
  rows: readonly EmbedSpeakerRow[],
  /** The date and room per session id. Empty in a caller that has not grouped the days yet. */
  slots: ReadonlyMap<string, EmbedSessionSlot> = new Map(),
): readonly EmbedSpeaker[] {
  // Insertion-ordered while it is being built, so the sessions under one speaker come out in
  // the order the schedule put them, and only then sorted by name.
  const bySpeaker = new Map<
    string,
    { speaker: EmbedSpeakerSource; sessions: EmbedSpeakerSession[] }
  >()

  for (const row of rows) {
    const session: EmbedSpeakerSession = {
      id: row.id,
      title: row.title,
      ...(slots.get(row.id) ?? {}),
    }
    for (const participant of row.participants) {
      const existing = bySpeaker.get(participant.speaker.id)
      if (existing === undefined) {
        bySpeaker.set(participant.speaker.id, {
          speaker: participant.speaker,
          sessions: [session],
        })
        continue
      }
      existing.sessions.push(session)
    }
  }

  return [...bySpeaker.values()]
    .map((entry) => ({
      speaker: toEmbedSpeaker(entry.speaker, entry.sessions),
      // Sorted on the SOURCE's surname rather than on anything parsed back out of the
      // display name: splitting "First Last" apart again would get every compound surname
      // and every single-word name wrong, and the two fields are right here.
      last: entry.speaker.lastName,
      first: entry.speaker.firstName,
    }))
    .toSorted(
      (left, right) =>
        left.last.localeCompare(right.last) ||
        left.first.localeCompare(right.first) ||
        left.speaker.id.localeCompare(right.speaker.id),
    )
    .map((entry) => entry.speaker)
}

/** One speaker, filtered to the deep link, or the whole roster when there is none. */
export function focusSpeakers(
  speakers: readonly EmbedSpeaker[],
  speakerId: string | undefined,
): readonly EmbedSpeaker[] {
  if (speakerId === undefined) return speakers
  return speakers.filter((speaker) => speaker.id === speakerId)
}

function toEmbedSpeaker(
  source: EmbedSpeakerSource,
  sessions: readonly EmbedSpeakerSession[],
): EmbedSpeaker {
  const name = `${source.firstName} ${source.lastName}`.trim()
  return {
    id: source.id,
    name,
    initials: initialsOf(source),
    ...(source.tagline === undefined ? {} : { tagline: source.tagline }),
    ...(source.company === undefined ? {} : { company: source.company }),
    ...(source.headshotUrl === undefined ? {} : { headshotUrl: source.headshotUrl }),
    ...bioOf(source),
    sessions,
  }
}

/**
 * The biography as sanitized HTML, or nothing at all when there is none to publish.
 *
 * Emptiness is judged on the PROSE of the sanitized result rather than on the stored string, and
 * both halves of that are load-bearing. A body of nothing but disallowed markup sanitizes to an
 * empty string; a body of `<p></p>` survives sanitizing intact and says nothing. Either has to
 * read as ABSENT, because the detail dialog branches on that to print `No biography yet.` and an
 * empty rendered block in its place looks like a rendering fault rather than a missing bio.
 */
function bioOf(source: EmbedSpeakerSource): { bio?: string } {
  if (source.bio === undefined) return {}
  const html = safeRichHtml(source.bio)
  return htmlToText(html).trim() === '' ? {} : { bio: html }
}

/**
 * `AO` for Ada Okafor. Falls back to whatever single initial exists, then to `?`.
 *
 * A blank first or last name is possible: both are required columns on Speakers, but a row
 * created in Airtable directly can carry a space, and an avatar reading `undefined` is worse
 * than one reading a single letter.
 *
 * Delegates to the one shared rule, which adds the EMAIL as a third source before giving up.
 * That is a small widening of what this file used to do and it is the right one: a speaker
 * with no name at all is exactly the row that most needs something in its circle, and the
 * public gallery is the worst place to print `?` next to a person.
 */
function initialsOf(source: EmbedSpeakerSource): string {
  return speakerInitials(source)
}
