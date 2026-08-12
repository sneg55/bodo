// Ownership checks for portal mutations.
//
// The layout guard proves somebody is logged in. It does not prove that THIS
// submission is theirs, and BUILD_SPEC 4 is explicit that a layout is not a security
// boundary: a Next app has several entry points and a layout does not re-run on every
// navigation. A portal that checked only the layout would let any speaker edit any
// submission by changing the code in the URL, and would let one speaker complete
// another's task by posting a different assignment id to the same Server Action.
//
// So every mutation in ./actions.ts calls one of these first. Both are pure and take
// the acting subject as an argument, which is what lets the refusal be unit tested
// instead of only reachable through a browser with two sessions.

import { requireSpeakerOwnership } from '@/features/auth/guards'
import type { SessionSubject } from '@/features/auth/tokens'
import { speakerOwnsSubmission } from '@/features/portal/own-submissions'
import type { PortalTaskItem } from '@/features/portal/ports'
import type { RecordId, StoredFile, SubmissionWithParticipants } from '@/types/domain'

/**
 * A submission belongs to its submitter AND to everyone on its roster, because a
 * co-speaker is presenting the session even though they did not file it.
 *
 * `requireSpeakerOwnership` compares the actor against one owner id, so the cast has
 * to be collapsed to a single id first. When the actor IS on the cast that id is their
 * own and the check passes; when they are not, the submitter's id is passed instead,
 * so the guard refuses AND its log line carries the real owner rather than a value
 * chosen to make the comparison fail.
 */
export function assertOwnsSubmission(
  actor: SessionSubject,
  submission: SubmissionWithParticipants,
): RecordId {
  const owner =
    actor.kind === 'speaker' && speakerOwnsSubmission(submission, actor.speakerId)
      ? actor.speakerId
      : submission.submitterId

  return requireSpeakerOwnership({
    actor,
    ownerSpeakerId: owner,
    resource: `submission ${submission.id}`,
  })
}

/** A task assignment belongs to exactly one speaker, so this one is a direct compare. */
export function assertOwnsAssignment(actor: SessionSubject, item: PortalTaskItem): RecordId {
  return requireSpeakerOwnership({
    actor,
    ownerSpeakerId: item.assignment.speakerId,
    resource: `task assignment ${item.assignment.id}`,
  })
}

/** A stored file belongs to the speaker who uploaded it. */
export function assertOwnsFile(actor: SessionSubject, file: StoredFile): RecordId {
  return requireSpeakerOwnership({
    actor,
    ownerSpeakerId: file.speakerId,
    resource: `file ${file.id}`,
  })
}

/** The acting speaker as a subject, for the checks above. */
export function speakerSubject(speakerId: RecordId): SessionSubject {
  return { kind: 'speaker', speakerId }
}
