// Adding and removing a participant from the portal, end to end. The Server Actions in
// ./roster-actions.ts are wrappers over these two and nothing else.
//
// The order of the first three steps is the security property, and it is the same order
// `save-body.ts` uses: resolve the acting speaker, resolve the record as THEIRS, then
// re-derive the edit policy from that record. Only then is anything written. BUILD_SPEC 4:
// a Server Action is reachable by POST with no layout ever rendering, so the page having
// rendered an Add control authorizes nothing.
//
// One thing this deliberately does NOT do is let the actor choose who the change is
// "from". A speaker may edit the cast of a submission they are on, and that is the whole
// permission: they cannot add themselves to somebody else's submission, because
// `resolveOwnSubmission` refuses a code that is not theirs before any of this runs.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ParticipantRole } from '@/constants/status'
import { requireSpeaker } from '@/features/auth/wiring'
import { resolveOwnSubmission } from '@/features/portal/resolve-submission'
import {
  additionProblems,
  type RosterMember,
  removalProblems,
  rosterEditable,
} from '@/features/portal/roster-rules'
import { bodyEditPermission } from '@/features/portal/submission-edit'
import {
  addSubmissionParticipant,
  removeSubmissionParticipant,
} from '@/services/airtable/mutations-participants'
import { upsertSpeakerByEmail } from '@/services/airtable/mutations-speakers'
import { listForms } from '@/services/airtable/queries'
import type { SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

export type AddParticipantInput = {
  /** `SESS-<n>`, the only handle the speaker's page ever holds. */
  code: string
  email: string
  firstName: string
  lastName: string
  role: ParticipantRole
}

export type RemoveParticipantInput = {
  code: string
  participantId: string
}

/** Matches the `guarded()` contract in ./actions.ts: a string is a success. */
type Outcome = string | { failed: string }

export async function addParticipant(input: AddParticipantInput): Promise<Outcome> {
  const { submission, form } = await editableSubmission(input.code)
  const roster = rosterOf(submission)

  const problems = additionProblems({
    roster,
    roles: form?.roles ?? [],
    email: input.email,
    role: input.role,
  })
  if (problems.length > 0) {
    return { failed: problems.map((problem) => problem.message).join(' ') }
  }

  // The same upsert the public submit uses, so a co-speaker who already has a Speakers
  // row (because they present elsewhere, or were imported) is LINKED rather than
  // duplicated. It expires `speaker:{id}` and `event:{id}:speakers` itself, through
  // `afterSpeakerWrite`, so the new person appears in the admin's speaker list and the
  // CRM directory without this module invalidating on top.
  //
  // `profileWrites: false`, matching the public submit and the organizer's own participants
  // panel. The two name boxes on this form are how a co-author who has NO record yet gets a
  // name; against an address that already resolves they are a guess typed by somebody else
  // while naming them, and writing them would put this speaker's typo over that person's own
  // profile. The create branch is untouched, and the event link is merged either way.
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

  // Guarded again on the RESOLVED speaker id, because the email check above cannot see a
  // person who is on the roster under a different address that upserts to the same row.
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
      // Never. The primary is the submitter and this path cannot create a second one:
      // two primaries make `primarySpeaker` and every "who do we email" read ambiguous.
      isPrimary: false,
      sortOrder: nextSortOrder(submission),
    },
  })

  return `${input.email.trim()} has been added to this submission.`
}

export async function removeParticipant(input: RemoveParticipantInput): Promise<Outcome> {
  const { submission } = await editableSubmission(input.code)
  const roster = rosterOf(submission)

  const problems = removalProblems(roster, input.participantId)
  if (problems.length > 0) {
    return { failed: problems.map((problem) => problem.message).join(' ') }
  }

  const member = roster.find((row) => row.id === input.participantId)
  if (member === undefined) return { failed: 'That person is not on this submission.' }

  await removeSubmissionParticipant({
    participantId: member.id,
    submissionId: submission.id,
    eventId: submission.eventId,
    speakerId: member.speakerId,
  })

  return 'That person has been removed from this submission.'
}

/**
 * The caller's own submission, refused unless its cast may be changed.
 *
 * The permission is re-derived from the record and the form here, never taken from the
 * caller, which is the same reason `save-body.ts` re-derives it: the page's answer decided
 * what to RENDER and authorizes nothing. A frozen submission raises rather than returning a
 * message, because it is a condition of the record and not a mistake in a field.
 */
async function editableSubmission(
  code: string,
): Promise<{ submission: SubmissionWithParticipants; form: Form | undefined }> {
  const { speakerId } = await requireSpeaker()
  const submission = await resolveOwnSubmission({ speakerId, code })

  // The submission's own event. Reading the configured one resolved the form, and therefore
  // the edit window, against the wrong conference for anything filed outside it.
  const forms = await listForms(submission.eventId)
  const form = forms.find((candidate) => candidate.id === submission.formId)
  const permission = bodyEditPermission({ status: submission.status, form, now: new Date() })
  if (!rosterEditable(permission)) {
    throw new AppError(ErrorIds.SUB_ILLEGAL_TRANSITION, permission.detail, {
      code,
      status: submission.status,
      mode: permission.mode,
    })
  }

  return { submission, form }
}

export function rosterOf(submission: SubmissionWithParticipants): readonly RosterMember[] {
  return submission.participants.map((participant) => ({
    id: participant.id,
    speakerId: participant.speakerId,
    email: participant.speaker.email,
    role: participant.role,
    isPrimary: participant.isPrimary,
  }))
}

/** After everyone already listed, so the roster keeps the order it was built in. */
function nextSortOrder(submission: SubmissionWithParticipants): number {
  return submission.participants.reduce((highest, row) => Math.max(highest, row.sortOrder), 0) + 1
}

function blank(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
