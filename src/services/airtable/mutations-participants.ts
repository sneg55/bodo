// Adding, removing and repointing one row of a submission's cast.
//
// `createSubmission` writes the whole cast at once, which was the only way a
// `SubmissionParticipants` row had ever been created: the cast was decided in the public
// wizard and frozen forever after. ABS-11 is the cost of that ("the portal's edit view of
// an existing submission has no add/remove participant control, so a co-author can only be
// attached while filling the public wizard"), and it needs these two.
//
// The third, `reassignSubmissionParticipant`, is the organizer's half of the same gap:
// with only add and remove, a session whose PRIMARY row points at the wrong Speakers record
// cannot be corrected at all, because the primary may not be removed (`removalProblems`
// refuses it, and `Submissions.submitter` is a required link). That was reproduced on the
// seeded base: SESS-23 was linked to a duplicate `Priya Raman` row and the only way to get
// the right person attached was to file SESS-33 as a duplicate session.
//
// Own file rather than more of mutations.ts, per the line limit, and the same rule holds
// as everywhere else here: every write ends by expiring the tags it affected, and the
// POLICY of who may call it is the caller's. This module is the write, and it deliberately
// re-derives nothing: `roster-edit.ts` decides ownership, edit mode and the role rules for
// the speaker portal, and `features/submissions/roster-admin.ts` does the same for the
// organizer.

import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { onlyRecord } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventAgendaTag,
  eventSubmissionsTag,
  speakerTag,
  submissionTag,
} from '@/services/airtable/tags'
import { link, type ParticipantDraft, participantFields } from '@/services/airtable/to-fields'
import type { RecordId } from '@/types/domain'

export type ParticipantChange = {
  submissionId: RecordId
  eventId: RecordId
  /** Whose portal row changes: the person being added or removed, not the actor. */
  speakerId: RecordId
}

export async function addSubmissionParticipant(
  input: ParticipantChange & { draft: ParticipantDraft },
  origin: WriteOrigin = 'action',
): Promise<RecordId> {
  const created = await getClient().createRecords(TABLES.submissionParticipants, [
    participantFields(input.draft, input.submissionId),
  ])

  // `finally`, for the reason `upsertSpeakerByEmail` documents: `onlyRecord` raises on a
  // 200 with an empty `records` array, and the row that response cannot name has still
  // been written. A raise between the write and the expiry would leave a co-speaker
  // invisible on both sides for the whole revalidate window.
  try {
    return onlyRecord(created, TABLES.submissionParticipants).id
  } finally {
    expire(origin, input)
  }
}

export async function removeSubmissionParticipant(
  input: ParticipantChange & { participantId: RecordId },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().deleteRecords(TABLES.submissionParticipants, [input.participantId])
  expire(origin, input)
}

export type ParticipantReassignment = {
  submissionId: RecordId
  eventId: RecordId
  participantId: RecordId
  /** The speaker the row points at now. Their portal must stop listing this session. */
  fromSpeakerId: RecordId
  /** The speaker the row should point at instead. */
  toSpeakerId: RecordId
  /**
   * Whether this row is the submission's primary participant.
   *
   * It decides a SECOND write, and that is why the caller has to say: `submitter` is a
   * link on `Submissions`, not a column on the participant row, so repointing the
   * participant alone would leave the acceptance email (`decision-preview.ts` resolves its
   * recipient from `submitter`) addressed to the person who was just taken off. The two
   * writes are what makes a primary reassignment complete.
   */
  isPrimary: boolean
}

/**
 * Point an existing cast row at a different Speakers record.
 *
 * A repoint rather than a remove-then-add, and the difference is not cosmetic: the row
 * carries `role`, `isPrimary` and `sortOrder`, and a delete-and-recreate would have to
 * reproduce all three, would break the primary case entirely (there is a moment with no
 * submitter, on a required link), and would change the participant id that
 * `SubmissionFiles` and the portal's own controls address the row by.
 */
export async function reassignSubmissionParticipant(
  input: ParticipantReassignment,
  origin: WriteOrigin = 'action',
): Promise<void> {
  const client = getClient()
  await client.updateRecords(TABLES.submissionParticipants, [
    { id: input.participantId, fields: { [COL.speaker]: link(input.toSpeakerId) } },
  ])

  if (input.isPrimary) {
    await client.updateRecords(TABLES.submissions, [
      { id: input.submissionId, fields: { [COL.submitter]: link(input.toSpeakerId) } },
    ])
  }

  // BOTH speakers, because a reassignment is a removal for one person and an addition for
  // the other: `speaker:{from}` is what makes the session disappear from the wrong
  // person's portal, and expiring only the new one would leave them still holding it.
  expire(origin, {
    submissionId: input.submissionId,
    eventId: input.eventId,
    speakerId: input.toSpeakerId,
  })
  expire(origin, {
    submissionId: input.submissionId,
    eventId: input.eventId,
    speakerId: input.fromSpeakerId,
  })
}

/**
 * The cast is on more screens than the one that changed it: the speaker's own portal
 * (`speaker:{id}`), the submission and the organizer's Abstracts list, which has a
 * `Speaker` column built from these rows, and the agenda, whose session cards name the
 * presenters. The agenda is `others` for the same reason a retitle is: nobody editing a
 * roster is looking at it.
 */
function expire(origin: WriteOrigin, input: ParticipantChange): void {
  invalidate(origin, {
    own: [
      eventSubmissionsTag(input.eventId),
      submissionTag(input.submissionId),
      speakerTag(input.speakerId),
    ],
    others: [eventAgendaTag(input.eventId)],
  })
}
