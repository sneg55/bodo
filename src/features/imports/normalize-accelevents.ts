// Accelevents' reads onto bodo's shapes. Pure. BUILD_SPEC 5.0e, Source C.
//
// THE ROUND-TRIP HAZARD, handled here rather than discovered later. Accelevents is the
// one provider bodo also PUSHES to (§5.7), so importing the same remote event bodo has
// been syncing into re-imports bodo's own writes and duplicates every session back into
// the base. `IntegrationMappings` records every remote id bodo authored; those ids are
// skipped and the skips are COUNTED, so a round trip is a number on the preview rather
// than a silent subtraction. The set is a parameter and is never read here: that keeps
// this pure and leaves the read with the DAL.
//
// The taxonomy assumption is the other thing this file has to be loud about. See
// `services/imports/accelevents-read.ts`: there is no documented list endpoint for tags
// and tracks, so both are derived from expanded sessions, and whether `expand` hydrates
// them is unverified. When nothing comes back, this warns rather than importing a
// programme with no taxonomy at all and calling the run clean.

import {
  clean,
  type NormalizedImport,
  type NormalizedRef,
  type NormalizedSpeaker,
  type NormalizedSubmission,
  needsEmailFrom,
  positionalParticipant,
  registerRef,
  splitName,
} from '@/features/imports/normalize-shared'
import { mapAcceleventsStatus } from '@/features/imports/status-map'
import type { AccelSession, AccelSpeaker } from '@/services/imports/accelevents-read'

export type AcceleventsPayload = {
  speakers: readonly AccelSpeaker[]
  sessions: readonly AccelSession[]
}

export type RoundTripGuard = {
  /** Remote ids `IntegrationMappings` says bodo authored. Skipped, and counted. */
  authoredRemoteIds: ReadonlySet<string>
}

function toSpeaker(speaker: AccelSpeaker): NormalizedSpeaker {
  const split = splitName(speaker.name)
  return {
    remoteId: speaker.id,
    // Present on this source, and still never invented when it is not.
    email: clean(speaker.email) ?? '',
    firstName: clean(speaker.firstName) ?? split.firstName,
    lastName: clean(speaker.lastName) ?? split.lastName,
    bio: clean(speaker.biography),
    company: clean(speaker.company),
    headshotUrl: clean(speaker.headshotUrl) ?? clean(speaker.profileImageUrl),
    links: {},
  }
}

export function normalizeAccelevents(
  payload: AcceleventsPayload,
  guard: RoundTripGuard,
): NormalizedImport {
  const tracks = new Map<string, NormalizedRef>()
  const tags = new Map<string, NormalizedRef>()
  const rooms = new Map<string, NormalizedRef>()

  const kept = payload.sessions.filter((session) => !guard.authoredRemoteIds.has(session.id))
  const skippedSubmissions = payload.sessions.length - kept.length

  const submissions = kept.map((session): NormalizedSubmission => {
    const trackIds = session.tracks.flatMap((track) => registerRef(tracks, track) ?? [])
    return {
      remoteId: session.id,
      title: clean(session.title) ?? '',
      description: clean(session.description),
      status: mapAcceleventsStatus(),
      // Accelevents publishes a programme, not a CFP queue, so nothing arrives from
      // there needing review and marking it reviewable would invent a decision.
      reviewRequired: false,
      format: clean(session.format),
      // bodo's Submission carries one track; extras beyond the first become nothing,
      // which is visible in the counts rather than silently merged into tags.
      trackRemoteId: trackIds[0],
      tagRemoteIds: session.tags.flatMap((tag) => registerRef(tags, tag) ?? []),
      roomRemoteId: registerRef(rooms, session.room),
      startsAt: clean(session.startTime),
      endsAt: clean(session.endTime),
      participants: session.speakers.map((entry, index) =>
        positionalParticipant(typeof entry === 'string' ? entry : entry.id, index),
      ),
    }
  })

  const keptSpeakers = payload.speakers.filter(
    (speaker) => !guard.authoredRemoteIds.has(speaker.id),
  )
  const speakers = keptSpeakers.map(toSpeaker)
  const skippedSpeakers = payload.speakers.length - keptSpeakers.length

  const warnings: string[] = []
  if (skippedSubmissions + skippedSpeakers > 0) {
    warnings.push(
      `${skippedSubmissions} session(s) and ${skippedSpeakers} speaker(s) were created by bodo's own Accelevents sync and were skipped, so this import will not duplicate them.`,
    )
  }
  if (submissions.length > 0 && tracks.size === 0 && tags.size === 0) {
    warnings.push(
      `No tracks or tags came back on ${submissions.length} session(s). Accelevents publishes no list endpoint for them, so they can only be read off expanded sessions. Nothing will be imported into Tracks or Tags.`,
    )
  }

  return {
    source: 'accelevents',
    rooms: [...rooms.values()],
    tracks: [...tracks.values()],
    tags: [...tags.values()],
    speakers,
    submissions,
    agendaItems: [],
    needsEmail: needsEmailFrom(speakers),
    skipped: { speakers: skippedSpeakers, submissions: skippedSubmissions },
    warnings,
  }
}
