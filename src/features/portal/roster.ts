// The participant roster on a submission detail page.
//
// BUILD_SPEC 5.2 asks for "each person's role and a Primary marker". Ordering is the
// part worth a pure function: the DAL sorts participants by `sortOrder` alone, and a
// co-speaker with sortOrder 1 would then render above the primary speaker. The
// primary is the person the organizer talks to, so it goes first regardless.

import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import { displayNameOf, initialsOf } from '@/features/portal/identity'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'

export type RosterEntry = {
  id: RecordId
  speakerId: RecordId
  name: string
  email: string
  initials: string
  /** The participant's own headshot when they have uploaded one; initials otherwise. */
  avatarUrl?: string
  roleLabel: string
  isPrimary: boolean
  /** True for the speaker who is looking at the page, so it can be marked "You". */
  isViewer: boolean
}

export function participantRoleLabel(role: ParticipantRole): string {
  // A Map lookup, because indexing a plain object with a variable is what
  // `security/detect-object-injection` exists to stop and that warning fails the build.
  return ROLE_LABELS.get(role) ?? role
}

const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

export function buildRoster(
  submission: SubmissionWithParticipants,
  /**
   * Who is looking, so their own row can be marked "You". Optional because the organizer's
   * detail page renders the same roster and there is no such person there: an admin is not
   * one of the participants, and marking a row "You" for them would be wrong rather than
   * merely unhelpful.
   */
  viewerSpeakerId: RecordId | undefined,
): readonly RosterEntry[] {
  return submission.participants
    .map((participant) => ({
      id: participant.id,
      speakerId: participant.speakerId,
      name: displayNameOf(participant.speaker),
      email: participant.speaker.email,
      initials: initialsOf(
        participant.speaker.firstName,
        participant.speaker.lastName,
        participant.speaker.email,
      ),
      avatarUrl: participant.speaker.headshotUrl,
      roleLabel: participantRoleLabel(participant.role),
      isPrimary: participant.isPrimary,
      isViewer: participant.speakerId === viewerSpeakerId,
      sortOrder: participant.sortOrder,
    }))
    .sort(byPrimaryThenOrder)
    .map(({ sortOrder: _sortOrder, ...entry }) => entry)
}

function byPrimaryThenOrder(
  left: { isPrimary: boolean; sortOrder: number },
  right: { isPrimary: boolean; sortOrder: number },
): number {
  if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1
  return left.sortOrder - right.sortOrder
}
