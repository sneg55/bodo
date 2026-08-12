// Writes: submissions, participants, scheduling.
//
// Speaker writes (the CFP upsert and the portal profile edit) live in
// mutations-speakers.ts, split out for the line limit.
//
// Every one of them ends by invalidating the tags it affected, through invalidate.ts,
// which owns what expiry means. A write that skips that is worse than a write that
// fails: the row changes and every screen keeps showing the old value until the
// revalidate window runs out.
//
// There is no fixture branch here. Reads fall back to fixtures so the app boots
// with an empty `.env` (source.ts); a write cannot, because a write that goes
// nowhere and reports success loses a speaker's submission. `getClient()` throws
// CFG_ENV_MISSING when there is no base, and that is the intended behaviour.

import type { SubmissionStatus } from '@/constants/status'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapSubmission } from '@/services/airtable/mapping'
import { onlyRecord } from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import {
  eventAgendaPublishedTag,
  eventAgendaTag,
  eventSubmissionsTag,
  speakerTag,
  submissionTag,
} from '@/services/airtable/tags'
import {
  type ParticipantDraft,
  participantFields,
  type ScheduleUpdate,
  type SubmissionDraft,
  type SubmissionEdit,
  scheduleFields,
  statusFields,
  submissionDraftFields,
  submissionEditFields,
} from '@/services/airtable/to-fields'
import type { RecordId, Submission } from '@/types/domain'

export type NewSubmission = {
  draft: SubmissionDraft
  participants: readonly ParticipantDraft[]
}

/**
 * Create a submission and its cast.
 *
 * Called from the public CFP route handler (origin `'route'`) and from the admin's
 * manual-add sheet (origin `'action'`); both invalidate the same way now, and
 * `WriteOrigin` in invalidate.ts says why the parameter is still there. Participant
 * rows are written after the submission because they link
 * to it, and the client chunks them at 10 records per request.
 */
export async function createSubmission(
  input: NewSubmission,
  origin: WriteOrigin = 'action',
): Promise<Submission> {
  const client = getClient()
  const created = await client.createRecords(TABLES.submissions, [
    submissionDraftFields(input.draft),
  ])
  const submission = mapSubmission(onlyRecord(created, TABLES.submissions))

  if (input.participants.length > 0) {
    await client.createRecords(
      TABLES.submissionParticipants,
      input.participants.map((participant) => participantFields(participant, submission.id)),
    )
  }

  invalidate(origin, {
    own: [
      eventSubmissionsTag(submission.eventId),
      submissionTag(submission.id),
      speakerTag(submission.submitterId),
    ],
  })
  return submission
}

export type StatusChange = {
  submissionId: RecordId
  eventId: RecordId
  status: SubmissionStatus
  /** Stamped by the Notify step, which is also what sends the email. Section 3. */
  notifiedAt?: string
  /**
   * The instant to record as the submit time when this is the first move into
   * `pending`. Optional so a caller can pass one instant for a whole batch, and so a
   * test can pass a fixed one; absent means "now", read here rather than in the caller
   * because a status change that forgets it leaves the Submitted column empty forever.
   */
  submittedAt?: string
}

/**
 * A status change, plus the submit stamp on the way into `pending`.
 *
 * The current value is read UNCACHED first, and it has to be: the rule is "stamp only
 * if it is still empty", and deciding that from a cached row would restamp a submission
 * an organizer pulled back out of a decision queue with today's date. One extra read
 * only on the transitions that could need it, which is why the read is inside the
 * branch. `statusFields` in to-fields.ts holds the rule itself, so it is unit tested.
 */
export async function setSubmissionStatus(
  change: StatusChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  const client = getClient()
  const currentSubmittedAt =
    change.status === 'pending' ? await readSubmittedAt(change.submissionId) : undefined

  await client.updateRecords(TABLES.submissions, [
    {
      id: change.submissionId,
      fields: statusFields({
        status: change.status,
        notifiedAt: change.notifiedAt,
        submittedAt: change.submittedAt ?? new Date().toISOString(),
        currentSubmittedAt,
      }),
    },
  ])

  invalidate(origin, {
    own: [eventSubmissionsTag(change.eventId), submissionTag(change.submissionId)],
    // An accept drops a session into the agenda's unscheduled tray, which is a
    // different screen and can lag by a beat.
    others: [eventAgendaTag(change.eventId)],
  })
}

/** What the row holds now, read fresh. `undefined` means the column is empty. */
async function readSubmittedAt(submissionId: RecordId): Promise<string | undefined> {
  return mapSubmission(await getClient().getRecord(TABLES.submissions, submissionId)).submittedAt
}

export type ScheduleChange = ScheduleUpdate & {
  submissionId: RecordId
  eventId: RecordId
  /**
   * The calendar identity to STORE, when this write produces an invite or a cancellation.
   * Absent means the change does not touch anybody's calendar, which is the common case:
   * publishing, unpublishing, and placing a session that is not yet accepted.
   *
   * These are the values the message will carry, decided by `planCalendarChange`
   * (features/agenda/calendar-plan.ts) and written here so the row and the mail agree.
   * They are NOT derived from what is already stored: the first invite is SEQUENCE 0 and
   * every later one is a bump, and only the planner knows which of those this is.
   */
  calendar?: { uid: string; sequence: number; status: 'active' | 'cancelled'; dtstamp: string }
}

/**
 * Moving a session that has already been invited is not just a column write.
 *
 * A calendar client decides whether an invite UPDATES an existing entry or creates
 * a second one by comparing UID and SEQUENCE. Same UID with a higher SEQUENCE is an
 * update; same UID and the same SEQUENCE is a duplicate that most clients ignore. So
 * rescheduling has to bump the stored sequence in the same write as the new times,
 * or the follow-up invite silently does nothing and every speaker keeps the old slot
 * on their calendar. BUILD_SPEC 5.3.
 *
 * The bump is here rather than in the caller because it must not be possible to move
 * a session and forget it. Enqueueing the updated invite is a separate step, and
 * deliberately so: the outbox is what makes sending idempotent (5.3), and the new
 * sequence is the key it will be recorded under.
 */
export async function scheduleSubmission(
  change: ScheduleChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  const fields = { ...scheduleFields(change) }

  if (change.calendar !== undefined) {
    // Written together, in the same update as the new times, because the invite that is
    // about to be enqueued is built from this row at SEND time. A sequence that lands
    // after the drain has read the row is a message carrying the old number, which every
    // client discards as a duplicate.
    //
    // The UID is written on every calendar write and not only the first. It is the same
    // value each time after that, so the write is idempotent, and making it conditional
    // meant one more branch that could leave a row with a sequence and no identity.
    fields[COL.calendarUid] = change.calendar.uid
    fields[COL.calendarSequence] = change.calendar.sequence
    fields[COL.calendarStatus] = change.calendar.status
    fields[COL.calendarDtstamp] = change.calendar.dtstamp
  }

  await getClient().updateRecords(TABLES.submissions, [{ id: change.submissionId, fields }])

  invalidate(origin, {
    own: [
      eventAgendaTag(change.eventId),
      // Room and times are columns on the submission row, so the abstracts table
      // is showing them too.
      eventSubmissionsTag(change.eventId),
      submissionTag(change.submissionId),
    ],
    others:
      change.scheduleStatus === 'published' ? [eventAgendaPublishedTag(change.eventId)] : undefined,
  })
}
