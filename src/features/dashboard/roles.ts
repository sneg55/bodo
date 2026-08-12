// PARTICIPANTS BY ROLE, ref 36: a deduplicated centre total and a stacked bar per role.
//
// The whole point of this module is the two grains ref 36's own description keeps apart:
// "Each row is unique people in that role on a submission. The center total deduplicates
// people in multiple roles." So a person who moderates one panel and speaks on another is
// TWO rows' worth of bar and ONE unique participant, and a naive count of
// SubmissionParticipants rows gets both numbers wrong at once (it also counts the same
// speaker once per talk).
//
// Pure, and tested in tests/dashboard-roles.test.ts, because neither number is checkable by
// looking at the screen: 6 is 6 whether or not it deduplicated anything.

import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import type { SubmissionWithParticipants } from '@/types/domain'

/**
 * Plural role names, because ref 36's legend reads "Speakers" while
 * `PARTICIPANT_ROLE_LABELS` is singular ("Speaker"), which is right for the picker it was
 * written for. Authored here rather than by appending an "s" so "Chairperson" pluralises
 * once, in a table someone can correct, instead of at every call site.
 */
export const ROLE_PLURAL_LABELS: Record<ParticipantRole, string> = {
  speaker: 'Speakers',
  co_speaker: 'Co-Speakers',
  moderator: 'Moderators',
  chairperson: 'Chairpersons',
}

export type RoleRow = {
  role: ParticipantRole
  label: string
  /** Unique PEOPLE holding this role, not participant rows. */
  count: number
  /** Share of the bar, 0-100 rounded. See the note in `participantsByRole`. */
  percent: number
}

export type RoleMixView = {
  /** Ref 36's centre stat: people, deduplicated across roles. */
  uniquePeople: number
  /** The bar's total, which is the sum of the rows and can exceed `uniquePeople`. */
  total: number
  rows: readonly RoleRow[]
}

type ParticipantOf = { speakerId: string; role: ParticipantRole }
type SubmissionOf = Pick<SubmissionWithParticipants, 'status'> & {
  participants: readonly ParticipantOf[]
}

/**
 * The centre total, and one row per role that anybody actually holds.
 *
 * Two decisions the reference cannot settle, both stated rather than hidden:
 *
 * - **Percent is a share of the BAR, not of the centre total.** With one role in use they
 *   are the same number, which is all ref 36 shows (Speakers 6, 100%, centre 6). They part
 *   company the moment somebody holds two roles, and then a percentage over the centre
 *   total would make the legend sum past 100% while the bar segments beside it visibly
 *   summed to a whole. The legend has to agree with the bar it labels.
 * - **A draft is not a submission**, so its cast is not in the programme. That is the same
 *   line the tiles and the forms row already draw (tests/dashboard-home.test.ts). Pending
 *   casts DO count, because ref 36 counts six participants on an event holding one accepted
 *   and three pending submissions, and because the copy says "on a submission".
 */
export function participantsByRole(submissions: readonly SubmissionOf[]): RoleMixView {
  const everyone = new Set<string>()
  const byRole = new Map<ParticipantRole, Set<string>>()

  for (const submission of submissions) {
    if (submission.status === 'draft') continue
    for (const participant of submission.participants) {
      everyone.add(participant.speakerId)
      const people = byRole.get(participant.role) ?? new Set<string>()
      people.add(participant.speakerId)
      byRole.set(participant.role, people)
    }
  }

  // Canonical role order, which is what "come from this event's participant role settings"
  // means here: the order the roles panel lists them in, so the bar's segments do not
  // reshuffle their colours when a count changes.
  const counted = PARTICIPANT_ROLES.flatMap((role) => {
    const count = byRole.get(role)?.size ?? 0
    return count === 0 ? [] : [{ role, count }]
  })
  const total = counted.reduce((sum, entry) => sum + entry.count, 0)

  return {
    uniquePeople: everyone.size,
    total,
    // A role nobody holds gets no row and no segment, rather than a 0% legend line: ref 36
    // shows one row on an event whose form enables four roles.
    rows: counted.map((entry) => ({
      role: entry.role,
      label: ROLE_PLURAL_LABELS[entry.role],
      count: entry.count,
      percent: total === 0 ? 0 : Math.round((entry.count / total) * 100),
    })),
  }
}

/**
 * Ref 34's "Accepted Speakers" KPI tile: distinct PEOPLE on an accepted submission.
 *
 * Here rather than in the page it feeds, because it is the same deduplication as the panel
 * above and the same trap: one speaker with three accepted talks is one accepted speaker.
 * Every participant counts and not only the primary, because a co-presenter who is presenting
 * is an accepted speaker by any reading an organizer cares about, and a missing headshot of
 * theirs is a hole in the same programme page (which is what `attention.ts` counts).
 */
export function acceptedSpeakerCount(submissions: readonly SubmissionOf[]): number {
  const people = new Set<string>()
  for (const submission of submissions) {
    if (submission.status !== 'accepted') continue
    for (const participant of submission.participants) people.add(participant.speakerId)
  }
  return people.size
}
