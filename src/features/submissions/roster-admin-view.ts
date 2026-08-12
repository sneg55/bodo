// What the organizer's Participants panel RENDERS. The writes are in ./roster-admin.ts.
//
// Split from that file because the two halves cross different boundaries: everything here
// is data on its way to a client component (`SubmissionParticipantsPanel.tsx`) and holds no
// authorization, while everything there authorizes and writes. The file-size hook forced
// the split and this is the seam it should fall on.

import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import { buildRoster, participantRoleLabel } from '@/features/portal/roster'
import { speakerInitials } from '@/features/speakers/initials'
import { listSpeakers } from '@/services/airtable/queries'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'

/** One cast row, as the panel renders it. Crosses the server-to-client boundary. */
export type AdminRosterRow = {
  id: RecordId
  speakerId: RecordId
  name: string
  email: string
  initials: string
  headshotUrl?: string
  roleLabel: string
  isPrimary: boolean
}

/**
 * The cast in reading order: primary first, then by `sortOrder`.
 *
 * Ordering and labels come from `buildRoster`, the portal's own builder, so the organizer's
 * panel and the speaker's page cannot disagree about who is primary. The viewer argument is
 * `undefined` because an admin is never one of the participants.
 *
 * The initials are the one thing recomputed, through `speakerInitials`: the portal's
 * `initialsOf` ends at the first letter of the EMAIL, which is `''` on a row whose name and
 * email columns are all blank, and an `AvatarFallback` handed `''` draws a circle with
 * nothing in it. See features/speakers/initials.ts.
 */
export function adminRosterRows(submission: SubmissionWithParticipants): readonly AdminRosterRow[] {
  const speakerByParticipant = new Map(
    submission.participants.map((participant) => [participant.id, participant.speaker]),
  )
  return buildRoster(submission, undefined).map((entry) => ({
    id: entry.id,
    speakerId: entry.speakerId,
    name: entry.name,
    email: entry.email,
    initials: speakerInitials(speakerByParticipant.get(entry.id) ?? {}),
    ...(entry.avatarUrl === undefined ? {} : { headshotUrl: entry.avatarUrl }),
    roleLabel: entry.roleLabel,
    isPrimary: entry.isPrimary,
  }))
}

/**
 * The roles the organizer's Add control offers: all of them.
 *
 * Not `assignableRoles(form.roles)`, which is what the SPEAKER's control uses. A form's
 * role rules are the constraint the speaker agreed to when submitting, and an organizer
 * adding a chairperson to a session whose form never offered one is a normal thing to do on
 * a programme. Same asymmetry ./roster-admin.ts describes about the close date.
 */
export const ADMIN_ROLE_OPTIONS: readonly { role: ParticipantRole; label: string }[] =
  PARTICIPANT_ROLES.map((role) => ({ role, label: participantRoleLabel(role) }))

/** One person the organizer may point a cast row at. Rendered by the Change speaker picker. */
export type RosterCandidate = {
  id: RecordId
  name: string
  email: string
  initials: string
  headshotUrl?: string
}

/**
 * Everyone on the event, for the picker.
 *
 * The event's Speakers table rather than a search endpoint: `listSpeakers` is a tagged,
 * cached read, and the picker filters in the browser. Duplicate names are the whole reason
 * this control exists, so the EMAIL is carried and shown beside every entry: "Priya Raman"
 * four times over is not a choice anybody can make.
 */
export async function listRosterCandidates(eventId: string): Promise<readonly RosterCandidate[]> {
  const speakers = await listSpeakers(eventId)
  return speakers.map((speaker) => ({
    id: speaker.id,
    name: `${speaker.firstName} ${speaker.lastName}`.trim() || speaker.email,
    email: speaker.email,
    initials: speakerInitials(speaker),
    ...(speaker.headshotUrl === undefined ? {} : { headshotUrl: speaker.headshotUrl }),
  }))
}
