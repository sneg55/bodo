// The organizer's speaker roster. SPK-01, and the read behind CNT-10's editor.
//
// A DIFFERENT SET from the public one, and the difference is the whole reason this is not
// `embedSpeakers`. That function is fed rows `publicAgendaRows` has already accepted, so a
// speaker appears there only through an accepted, published, uncancelled session. This reads
// the event's `Speakers` TABLE, which is every person who has ever submitted or been added,
// including the ones whose submissions were declined, withdrawn or are still pending. That
// set is exactly right for an organizer and exactly wrong for a public page, and mixing them
// up is how a gallery publishes the fact that a named person applied and was turned down.
//
// Session counts come from one `listSubmissions` pass rather than a lookup per speaker. A
// roster of eighty speakers must not be eighty Airtable round trips; BUILD_SPEC 3.1.

import type { SpeakerStatus } from '@/constants/status'
import { speakerInitials } from '@/features/speakers/initials'
import { listSpeakers, listSubmissions } from '@/services/airtable/queries'
import type { RecordId, Speaker } from '@/types/domain'

export type RosterSpeaker = {
  id: RecordId
  name: string
  email: string
  initials: string
  company?: string
  tagline?: string
  bio?: string
  headshotUrl?: string
  /**
   * Where the person is in the organizer's process. Defaulted to `prospect` rather than
   * left undefined, because the roster groups and filters on it and a blank cell there
   * would read as a broken row rather than as "nobody has moved them along yet".
   */
  status: SpeakerStatus
  dietary?: string
  travelNotes?: string
  /** When the portal invitation was last sent to them, or absent if it never was. */
  invitedAt?: string
  /** How many of the event's submissions this person is on, in any role or status. */
  submissionCount: number
  /** True when at least one of them was accepted. NOT the same as `status: confirmed`. */
  hasAccepted: boolean
}

export type SpeakerRoster = {
  speakers: readonly RosterSpeaker[]
}

export async function loadSpeakerRoster(eventId: string): Promise<SpeakerRoster> {
  const [speakers, submissions] = await Promise.all([
    listSpeakers(eventId),
    listSubmissions(eventId),
  ])

  // Counted over PARTICIPANTS, not over `submitterId`. A co-presenter is on the session
  // without having filed it, and a roster that only counted submitters would show them with
  // nothing and read as though they had withdrawn.
  const counts = new Map<RecordId, { total: number; accepted: number }>()
  for (const submission of submissions) {
    for (const participant of submission.participants) {
      const entry = counts.get(participant.speakerId) ?? { total: 0, accepted: 0 }
      entry.total += 1
      if (submission.status === 'accepted') entry.accepted += 1
      counts.set(participant.speakerId, entry)
    }
  }

  return {
    speakers: speakers
      .map((speaker) => toRosterSpeaker(speaker, counts.get(speaker.id)))
      // By surname, for the reason the public roster now sorts that way: "First Last" order
      // is alphabetical by given name, which is not what anyone scanning a list of people
      // expects. The source fields are right here, so nothing is parsed back apart.
      .toSorted(
        (left, right) =>
          left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id),
      )
      .map((entry) => entry.speaker),
  }
}

function toRosterSpeaker(
  speaker: Speaker,
  count: { total: number; accepted: number } | undefined,
): { speaker: RosterSpeaker; sortKey: string; id: RecordId } {
  const name = `${speaker.firstName} ${speaker.lastName}`.trim()
  return {
    id: speaker.id,
    sortKey: `${speaker.lastName} ${speaker.firstName}`.trim().toLowerCase(),
    speaker: {
      id: speaker.id,
      // A speaker created by a submission always has an email and may have no name yet, so
      // the address stands in rather than leaving a blank cell that reads as a broken row.
      name: name === '' ? speaker.email : name,
      email: speaker.email,
      initials: speakerInitials(speaker),
      ...(speaker.company === undefined ? {} : { company: speaker.company }),
      ...(speaker.tagline === undefined ? {} : { tagline: speaker.tagline }),
      ...(speaker.bio === undefined ? {} : { bio: speaker.bio }),
      ...(speaker.headshotUrl === undefined ? {} : { headshotUrl: speaker.headshotUrl }),
      // A row written before the column existed has no status, and `prospect` is the
      // honest reading of that: they are on the event and nobody has moved them along.
      status: speaker.status ?? 'prospect',
      ...(speaker.dietary === undefined ? {} : { dietary: speaker.dietary }),
      ...(speaker.travelNotes === undefined ? {} : { travelNotes: speaker.travelNotes }),
      ...(speaker.invitedAt === undefined ? {} : { invitedAt: speaker.invitedAt }),
      submissionCount: count?.total ?? 0,
      hasAccepted: (count?.accepted ?? 0) > 0,
    },
  }
}
