// The one write behind the organizer's content editor, and the history it appends.
//
// Its own module, and NOT part of ./content-actions.ts, for a mechanical reason: a
// `'use server'` file may only export async functions that are safe to expose as
// endpoints, so the moment two actions needed to share this write it had to move out
// rather than become a third export next to them.
//
// Sharing it is the whole point. Save and Restore are the same act on this record: both
// resolve the submission against the authorized event, both run the values through
// `prepareContentEdit`, and both append whatever actually changed to the history. If
// restore had its own writer it would be the one that eventually skipped the length check
// or forgot the revision row, and the bug would only surface on the rarer path.
//
// The write and the history are two calls and cannot be one, because they are two tables.
// The order is: content first, history second. If the history write fails the edit still
// stands, which is the right way round: an organizer who was told the save worked must
// find it saved, and a missing audit row is a smaller loss than an edit that silently did
// not happen. The reverse order could log a change that was never made.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { abstractField, prepareContentEdit, storedAbstract } from '@/features/review/content-edit'
import { listEventReviewers } from '@/features/review/review-reads'
import { updateSubmission } from '@/services/airtable/mutations-content'
import { getSubmission, listForms } from '@/services/airtable/queries'
import { appendRevisions } from '@/services/airtable/revisions'
import type { RecordId, SubmissionWithParticipants } from '@/types/domain'
import type { Form } from '@/types/forms'

/** The record plus the form its answers are keyed by, which every caller here needs. */
export type ContentSubject = {
  submission: SubmissionWithParticipants
  /** Absent for a session entered by hand; `abstractField` covers that case. */
  form?: Form
  title: string
  abstract: string
}

/**
 * Resolve a submission and its form, scoped to the event in the URL.
 *
 * The event scope is not decoration. A submission id is client input, so an admin of one
 * event must not be able to retitle another event's session by posting its id. Answered
 * as not-found rather than forbidden, so the id cannot be probed.
 */
export async function contentSubject(
  eventId: RecordId,
  submissionId: RecordId,
): Promise<ContentSubject> {
  const submission = await getSubmission(submissionId)
  if (submission.eventId !== eventId) {
    throw new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that submission is not on this event', {
      eventId,
      submissionId,
    })
  }

  const form = (await listForms(eventId)).find((candidate) => candidate.id === submission.formId)
  return {
    submission,
    form,
    title: submission.title,
    abstract: storedAbstract(submission, abstractField(form)),
  }
}

export type ContentWriteResult = { title: string; abstract: string; changed: number }

/**
 * Apply a title and abstract to a resolved submission, recording what moved.
 *
 * Returns what was STORED rather than what was posted, because the two differ: the values
 * are trimmed here, so a save of `" Talk "` must leave the editor showing what the record
 * now holds and not what was keyed.
 */
export async function applyContentEdit(input: {
  eventId: RecordId
  editorId: RecordId
  subject: ContentSubject
  title: string
  abstract: string
}): Promise<ContentWriteResult> {
  const { submission, form } = input.subject
  const { edit, changes } = prepareContentEdit({
    submission,
    form,
    title: input.title,
    abstract: input.abstract,
  })
  const abstract = storedAbstract({ ...submission, answers: edit.answers }, abstractField(form))

  // Nothing changed, so nothing is written and nothing is logged. An organizer who opens
  // the editor and presses Save should not leave a history entry saying they edited it,
  // and a restore of the value already showing should not either.
  if (changes.length === 0) return { title: submission.title, abstract, changed: 0 }

  await updateSubmission({ ...edit, submissionId: submission.id, eventId: input.eventId })

  // One instant for every row of this save, taken once. Reading the clock per row would
  // let a two-field edit sort as two separate saves in the history.
  const at = new Date().toISOString()
  try {
    const editorName = await editorLabel(input.eventId, input.editorId)
    await appendRevisions(
      changes.map((change) => ({
        eventId: input.eventId,
        submissionId: submission.id,
        fieldLabel: change.field,
        previousValue: change.from,
        newValue: change.to,
        editorName,
        at,
      })),
    )
  } catch (error) {
    // Logged, never raised, and this is the one swallow here. The edit above has already
    // landed, so raising would tell an organizer their save failed when it did not, and
    // they would make it again. It also keeps the feature working against a base created
    // before `ContentRevisions` was declared: the history stays empty and says so, rather
    // than the editor refusing every save. Run `npm run airtable:schema` to add the table.
    console.error(
      `[${ErrorIds.DATA_WRITE_FAIL}] submission ${submission.id} saved but its revisions were not recorded: ${String(error)}`,
    )
  }

  return { title: edit.title, abstract, changed: changes.length }
}

/**
 * How the history names the person who made the change.
 *
 * The name where the account has one, the address otherwise, and the id as a last resort
 * so an attribution is never blank. Denormalised into the revision row on purpose: see
 * the migration's note. It means a later rename does not rewrite history, which is what
 * an audit trail wants.
 *
 * Read from the event's own member list rather than the whole `AdminUsers` table: the
 * caller was just authorized as an admin OF THIS EVENT, so they are on it, and that list
 * is already cached for this request by the surface that rendered the editor.
 */
async function editorLabel(eventId: RecordId, userId: RecordId): Promise<string> {
  const user = (await listEventReviewers(eventId)).find((candidate) => candidate.id === userId)
  if (user === undefined) return userId
  return user.name.trim() === '' ? user.email : user.name
}
