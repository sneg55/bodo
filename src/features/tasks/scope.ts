// Who an assignment run applies to.
//
// SPEC.md R6 says "admin assigns a 3-task checklist to accepted speakers", so the scope
// is read off the submissions rather than off the Speakers table: being a speaker at the
// event is not the same fact as having something accepted, and the Speakers table has no
// column that could tell them apart.
//
// Every PARTICIPANT on an accepted submission is in scope, not only the primary. The
// seed script (scripts/seed/steps-portal.ts) fans out to the primary speaker alone, and
// that is a property of the seed rather than the rule: a co-speaker still has to upload a
// headshot, and an onboarding checklist that skipped them would be silently incomplete.
//
// Pure, and unit tested in tests/tasks-scope.test.ts, because both edge cases here are
// arithmetic that is expensive to see through the UI: one speaker on three accepted
// submissions has to produce three submission-scoped rows and one contact-scoped row, and
// the same speaker appearing twice on one submission must not double either.

import type { RecordId, Speaker, SubmissionWithParticipants } from '@/types/domain'

export type SpeakerScope = {
  speaker: Speaker
  /**
   * The accepted submissions this speaker is on, deduplicated, in the order the
   * submissions were read. A submission-scoped task produces one assignment per entry.
   */
  submissionIds: readonly RecordId[]
}

/** `Ada Okafor`, or the email when a record carries no name at all. */
export function speakerDisplayName(speaker: Speaker): string {
  const name = `${speaker.firstName} ${speaker.lastName}`.trim()
  return name.length > 0 ? name : speaker.email
}

/**
 * The accepted cast, one entry per person.
 *
 * `accepted` only. `accept_queue` is a decision staged but not committed (the Notify step
 * in BUILD_SPEC 5.3 is what moves it), so fanning tasks out to it would email onboarding
 * work to a speaker who has not been told they are in.
 */
export function acceptedSpeakerScopes(
  submissions: readonly SubmissionWithParticipants[],
): readonly SpeakerScope[] {
  const bySpeaker = new Map<RecordId, { speaker: Speaker; submissionIds: RecordId[] }>()

  for (const submission of submissions) {
    if (submission.status !== 'accepted') continue

    for (const participant of submission.participants) {
      const existing = bySpeaker.get(participant.speakerId)
      const scope = existing ?? { speaker: participant.speaker, submissionIds: [] }
      if (!scope.submissionIds.includes(submission.id)) scope.submissionIds.push(submission.id)
      bySpeaker.set(participant.speakerId, scope)
    }
  }

  return [...bySpeaker.values()].sort(byName)
}

function byName(left: { speaker: Speaker }, right: { speaker: Speaker }): number {
  const compared = speakerDisplayName(left.speaker).localeCompare(speakerDisplayName(right.speaker))
  // Ties broken on the record id so the table does not reshuffle between reads when two
  // people share a name.
  return compared === 0 ? left.speaker.id.localeCompare(right.speaker.id) : compared
}
