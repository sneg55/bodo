// Assigning a task to speakers an organizer NAMES, rather than to the accepted cohort.
//
// `acceptedSpeakerScopes` next door answers "who is accepted", and until now it was the only
// answer this product had: the single assignment path fanned every task out to the accepted
// cast and nothing else. That is a real hole rather than a fixture accident. An organizer
// cannot put a task on
//
//   - a confirmed speaker whose talk has not been decided yet,
//   - a prospect they are courting,
//   - somebody added straight to the roster or imported from a spreadsheet, who has no
//     submission at all and never will.
//
// All three are ordinary, and for a keynote invited over email the accepted-cohort path is
// not merely inconvenient, it is unreachable. So this is the second scope builder, and it
// takes a list of speaker ids.
//
// IT DOES NOT RE-DECIDE WHAT ACCEPTED MEANS. The submission ids each chosen speaker carries
// come from `acceptedSpeakerScopes`, so a submission-scoped task assigned by hand lands on
// exactly the sessions the bulk path would have used. A second reading of "accepted" here
// would be the same class of defect as a second merge-field renderer: two paths that agree
// until the day they do not.
//
// THE TRAP THIS MODULE EXISTS TO SURFACE: a submission-scoped task assigned to a speaker with
// no accepted submission writes NOTHING. `planFanout` refuses to invent a row with an empty
// submission link (features/assignments/fanout.ts) and it is right to, but the organizer
// presses Assign, gets a success, and the speaker's portal stays empty. That is precisely how
// SPK-09 came to be unjudgeable. `unreachableScopes` names those speakers so the caller can
// say so instead of reporting a silent success.
//
// Pure, and tested in tests/tasks-roster-scope.test.ts.

import type { SpeakerStatus } from '@/constants/status'
import { planAssignments } from '@/features/tasks/plan'
import {
  acceptedSpeakerScopes,
  type SpeakerScope,
  speakerDisplayName,
} from '@/features/tasks/scope'
import type { RecordId, Speaker, SubmissionWithParticipants, Task } from '@/types/domain'

/** One roster row as the picker renders it. Deliberately small: this crosses to the client. */
export type AssignableSpeaker = {
  id: RecordId
  /** `Ada Okafor`, or the email when the record carries no name. */
  name: string
  email: string
  status: SpeakerStatus
  /**
   * How many accepted submissions this person is on.
   *
   * Rendered by the picker, and not decoration: zero is the difference between a
   * submission-scoped task reaching them and writing nothing at all.
   */
  acceptedSubmissions: number
}

/**
 * Everybody on the event's roster, in the order the picker shows them.
 *
 * The ROSTER, not the accepted cast, which is the whole point: `listSpeakers(eventId)` is
 * scoped by the `events` link, so this is every person an organizer has on this event by any
 * route - CFP submitter, co-presenter, CSV import, or added by hand this morning.
 */
export function assignableSpeakers(input: {
  speakers: readonly Speaker[]
  submissions: readonly SubmissionWithParticipants[]
}): readonly AssignableSpeaker[] {
  const accepted = acceptedBySpeaker(input.submissions)

  return [...input.speakers]
    .map((speaker) => ({
      id: speaker.id,
      name: speakerDisplayName(speaker),
      email: speaker.email,
      // Absent reads as `prospect`, the same default every surface that groups by this
      // column applies (types/domain.ts on `Speaker.status`).
      status: speaker.status ?? 'prospect',
      acceptedSubmissions: (accepted.get(speaker.id) ?? []).length,
    }))
    .sort((left, right) => compareRows(left, right))
}

export type ChosenScopes = {
  /** One scope per chosen speaker, in display-name order. */
  scopes: readonly SpeakerScope[]
  /** Ids that are not on this event's roster. The caller refuses rather than skipping. */
  unknown: readonly RecordId[]
}

/**
 * The scopes for the speakers an organizer picked.
 *
 * RESOLVED AGAINST THE EVENT'S OWN ROSTER, and that is the authorization rather than a
 * convenience: a speaker id is client input, and an action that trusted it would let an
 * admin of event A put a task on event B's speaker by posting their record id. The same rule
 * `resolveEventSpeaker` applies to the profile editor, applied to a list.
 *
 * A duplicate id yields one scope. The planner deduplicates tuples anyway, so this is about
 * the COUNT the caller reports: "assigned across 3 speakers" for a list naming two people is
 * a number an organizer would rightly not believe.
 */
export function chosenSpeakerScopes(input: {
  speakers: readonly Speaker[]
  submissions: readonly SubmissionWithParticipants[]
  speakerIds: readonly RecordId[]
}): ChosenScopes {
  const accepted = acceptedBySpeaker(input.submissions)
  const byId = new Map(input.speakers.map((speaker) => [speaker.id, speaker]))

  const scopes: SpeakerScope[] = []
  const unknown: RecordId[] = []
  const seen = new Set<RecordId>()

  for (const speakerId of input.speakerIds) {
    if (seen.has(speakerId)) continue
    seen.add(speakerId)

    const speaker = byId.get(speakerId)
    if (speaker === undefined) {
      unknown.push(speakerId)
      continue
    }
    scopes.push({ speaker, submissionIds: accepted.get(speakerId) ?? [] })
  }

  return {
    scopes: scopes.sort((left, right) => compareScopes(left, right)),
    unknown,
  }
}

/**
 * The chosen speakers this run would write nothing for, named.
 *
 * Decided by RUNNING THE PLANNER one scope at a time rather than by re-reading the rule, so
 * the answer cannot drift from what is actually about to be written. `existing: []` is
 * deliberate: a speaker who already has every row is not unreachable, they are already done,
 * and the caller's `skipped` count is what says so.
 */
export function unreachableScopes(input: {
  tasks: readonly Task[]
  scopes: readonly SpeakerScope[]
}): readonly SpeakerScope[] {
  return input.scopes.filter(
    (scope) =>
      planAssignments({ tasks: input.tasks, scopes: [scope], existing: [] }).create.length === 0,
  )
}

/** The accepted submission ids per speaker, read off the one function that decides that. */
function acceptedBySpeaker(
  submissions: readonly SubmissionWithParticipants[],
): ReadonlyMap<RecordId, readonly RecordId[]> {
  return new Map(
    acceptedSpeakerScopes(submissions).map((scope) => [scope.speaker.id, scope.submissionIds]),
  )
}

function compareRows(left: AssignableSpeaker, right: AssignableSpeaker): number {
  const compared = left.name.localeCompare(right.name)
  // Ties broken on the record id, so a picker with two people of the same name does not
  // reshuffle between reads. Same rule as `acceptedSpeakerScopes`.
  return compared === 0 ? left.id.localeCompare(right.id) : compared
}

function compareScopes(left: SpeakerScope, right: SpeakerScope): number {
  const compared = speakerDisplayName(left.speaker).localeCompare(speakerDisplayName(right.speaker))
  return compared === 0 ? left.speaker.id.localeCompare(right.speaker.id) : compared
}
