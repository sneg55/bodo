// The ORGANIZER's edit of a submission's cast: add somebody, take somebody off, point a
// row at a different person.
//
// The gap this closes was reproduced on the seeded base and cost a duplicate record:
// SESS-23 "Taming 40-Minute CI" was linked to the wrong `Priya Raman` row (there are four
// of them, from imports and portal sign-ups), the detail page rendered Participants as a
// read-only list, EDIT opened Title and Abstract only, and the speaker's own edit sheet has
// no session field. The only way to get the right person attached was to file SESS-33 as a
// duplicate session.
//
// Deliberately NOT `features/portal/roster-edit.ts`, and the asymmetry is the same one
// `features/review/content-edit.ts` sets out. That path is the SPEAKER changing their own
// submission, so it resolves the record through `resolveOwnSubmission` and gates on
// `bodyEditPermission`: open while the form still accepts updates, locked once a decision
// is made. An organizer is not subject to that lock. A programme chair repointing an
// accepted talk at the right speaker the week before the event is the ordinary case, and
// refusing it because the CFP closed would be the tool arguing with the person who owns
// the data.
//
// What it DOES share is everything that is a fact about the record rather than about who
// is asking: `rosterOf` builds the same member list, `additionProblems` and
// `removalProblems` are the same rules, and the writes are the same three DAL functions.
// A second implementation of "is this person already on it" would eventually disagree with
// the portal's about the same submission.
//
// Pure-ish: it resolves records and calls the DAL. The rules it applies are already unit
// tested in `tests/portal-roster-rules.test.ts`; what is asserted here
// (`tests/submissions-roster-admin.test.ts`) is the part that is new, namely that a primary
// reassignment carries the submitter with it and expires both speakers.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { PARTICIPANT_ROLES, type ParticipantRole } from '@/constants/status'
import { requireEventRole } from '@/features/auth/wiring'
import { rosterOf } from '@/features/portal/roster-edit'
import { additionProblems, removalProblems } from '@/features/portal/roster-rules'
import {
  addSubmissionParticipant,
  reassignSubmissionParticipant,
  removeSubmissionParticipant,
} from '@/services/airtable/mutations-participants'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { getSubmission, listSpeakers } from '@/services/airtable/queries'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'
import type { ParticipantRoleRule } from '@/types/forms'

export type AdminAddInput = {
  eventId: RecordId
  submissionId: RecordId
  email: string
  firstName: string
  lastName: string
  role: ParticipantRole
}

export type AdminRemoveInput = {
  eventId: RecordId
  submissionId: RecordId
  participantId: RecordId
}

export type AdminReassignInput = {
  eventId: RecordId
  submissionId: RecordId
  participantId: RecordId
  /** The Speakers record the row should point at. Must already exist on the event. */
  speakerId: RecordId
}

/** Matches what the Server Actions hand back: a string is a success message. */
type Outcome = string | { failed: string }

/**
 * Every participant role, enabled, with no minimum and no maximum.
 *
 * The organizer's stand-in for a form's `rolesJson`. `Number.MAX_SAFE_INTEGER` rather than
 * `Infinity` because the value is only ever compared with `count > rule.max`, and an
 * infinity would print as `Infinity` if a message ever quoted it.
 */
const UNCAPPED_ROLES: readonly ParticipantRoleRule[] = PARTICIPANT_ROLES.map((role) => ({
  role,
  enabled: true,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
}))

export async function addParticipantToSubmission(input: AdminAddInput): Promise<Outcome> {
  const submission = await adminSubmission(input.eventId, input.submissionId)
  const roster = rosterOf(submission)

  // Every role enabled and uncapped, rather than the form's own `rolesJson`, and that is
  // the asymmetry this file's header describes. A form's role rules are what the SPEAKER
  // agreed to; refusing an organizer a chairperson because the CFP never offered one is the
  // tool arguing with the person who owns the programme.
  //
  // NOT `roles: []`, which was the first attempt and is the opposite of no rules: an empty
  // list means no role is ENABLED, so `validateParticipants` reports every participant as a
  // role this form does not accept and the add is refused. The unit test caught it. What
  // still applies is the part that is a fact about the record rather than about the form:
  // the address has to be an address, and nobody may be on the submission twice.
  const problems = additionProblems({
    roster,
    roles: UNCAPPED_ROLES,
    email: input.email,
    role: input.role,
  })
  if (problems.length > 0) {
    return { failed: problems.map((problem) => problem.message).join(' ') }
  }

  // The same upsert the public submit and the portal's own Add use, so a person who
  // already has a Speakers row is LINKED rather than duplicated. Duplicated speaker rows
  // are what made this defect expensive in the first place.
  //
  // `profileWrites: false`, and it is the whole reason this control is safe on a base with
  // four rows reading "Priya Raman". The two name boxes here are how a NEW person gets a
  // name; on an address that already resolves to somebody, they are a guess typed by
  // somebody who is naming a co-speaker, not editing a profile. Without this, an organizer
  // adding `gita@deckllama.com` as "Gita R" would rewrite Gita Raman's CRM record, silently
  // and across every event she is on. The create branch is untouched, so a genuinely new
  // co-speaker still arrives with the typed name, and the event link is merged either way.
  // Editing a profile has its own surface (`features/speakers/SpeakerEditSheet`).
  const speaker = await upsertSpeakerByEmail(
    {
      email: input.email.trim().toLowerCase(),
      firstName: blank(input.firstName),
      lastName: blank(input.lastName),
      eventIds: [submission.eventId],
    },
    'action',
    { profileWrites: false },
  )

  // Re-asked on the RESOLVED id, because the email check above cannot see somebody who is
  // already on the roster under a different address that upserts to the same row.
  if (roster.some((member) => member.speakerId === speaker.id)) {
    return { failed: 'That person is already on this submission.' }
  }

  await addSubmissionParticipant({
    submissionId: submission.id,
    eventId: submission.eventId,
    speakerId: speaker.id,
    draft: {
      speakerId: speaker.id,
      role: input.role,
      // Never a second primary: `primarySpeaker` and every "who do we email" read become
      // ambiguous with two. Making somebody else primary is a reassignment of the
      // existing primary row, which is what `reassignParticipantOnSubmission` is for.
      isPrimary: false,
      sortOrder: nextSortOrder(submission),
    },
  })

  return `${input.email.trim()} has been added to this session.`
}

export async function removeParticipantFromSubmission(input: AdminRemoveInput): Promise<Outcome> {
  const submission = await adminSubmission(input.eventId, input.submissionId)
  const roster = rosterOf(submission)

  const problems = removalProblems(roster, input.participantId)
  if (problems.length > 0) {
    return { failed: problems.map((problem) => problem.message).join(' ') }
  }

  const member = roster.find((row) => row.id === input.participantId)
  if (member === undefined) return { failed: 'That person is not on this session.' }

  await removeSubmissionParticipant({
    participantId: member.id,
    submissionId: submission.id,
    eventId: submission.eventId,
    speakerId: member.speakerId,
  })

  return 'That person has been removed from this session.'
}

/**
 * Point an existing cast row at a different person.
 *
 * This is the operation the defect actually needed. Add plus Remove cannot express it on
 * the PRIMARY row, because `removalProblems` refuses to remove the submitter and
 * `Submissions.submitter` is a required link, so a session created against the wrong
 * record was uncorrectable. It is also the right shape for a non-primary row: the row
 * carries the role and the sort order, and a delete-and-recreate would silently reset both.
 */
export async function reassignParticipantOnSubmission(input: AdminReassignInput): Promise<Outcome> {
  const submission = await adminSubmission(input.eventId, input.submissionId)
  const member = submission.participants.find((row) => row.id === input.participantId)
  if (member === undefined) return { failed: 'That person is not on this session.' }

  if (member.speakerId === input.speakerId) {
    return { failed: 'That row already points at this speaker.' }
  }
  if (submission.participants.some((row) => row.speakerId === input.speakerId)) {
    return { failed: 'That person is already on this submission.' }
  }

  // Checked against the EVENT's speakers rather than trusted from the form post: a record
  // id is a string in a Server Action payload, and linking a submission to a speaker on
  // somebody else's event would be a cross-event write with no other guard in front of it.
  const candidates = await listSpeakers(input.eventId)
  const target = candidates.find((speaker) => speaker.id === input.speakerId)
  if (target === undefined) {
    return { failed: 'That speaker is not on this event.' }
  }

  await reassignSubmissionParticipant({
    submissionId: submission.id,
    eventId: submission.eventId,
    participantId: member.id,
    fromSpeakerId: member.speakerId,
    toSpeakerId: target.id,
    isPrimary: member.isPrimary,
  })

  const name = `${target.firstName} ${target.lastName}`.trim() || target.email
  return member.isPrimary
    ? `${name} is now the submitter of this session.`
    : `${name} is now on this session.`
}

/**
 * The submission, refused unless the caller administers the event it belongs to.
 *
 * The event id is re-checked against the RECORD and not only against the session, for the
 * reason `loadSubmissionDetail` gives about the same pair of ids: a submission id is a path
 * segment and a Server Action argument, so an organizer of one event must not be able to
 * write another's cast by pasting its id. `requireEventRole` proves the role on the event
 * named in the payload; this proves the record is that event's.
 */
async function adminSubmission(
  eventId: RecordId,
  submissionId: RecordId,
): Promise<SubmissionWithParticipants> {
  await requireEventRole(eventId, 'admin')
  const submission = await getSubmission(submissionId)
  if (submission.eventId !== eventId) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'That session is not on this event.', {
      submissionId,
      eventId,
    })
  }
  return submission
}

/** After everyone already listed, so the roster keeps the order it was built in. */
function nextSortOrder(submission: SubmissionWithParticipants): number {
  return submission.participants.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1
}

function blank(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
