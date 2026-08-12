'use server'

// Duplicating and deleting a submission form.
//
// Their own module because `./actions.ts` is at the size limit, and this is the seam that
// falls out of it: that file is the editor's writes (create, save, publish), this one is the
// two things the list card can do to a whole form.
//
// The rules are its neighbour's, and they are not negotiable here either. Both authorize for
// themselves with `requireEventRole(eventId, 'admin')`, because a Server Action is reachable
// by POST without a layout ever rendering, and both resolve the form through
// `loadFormEditor`, which finds it among the event's own CFP forms: a formId from another
// event, or a portal form's id, resolves to nothing rather than being acted on.

import { nanoid } from 'nanoid'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { loadFormEditor } from '@/features/forms/builder/reads'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createForm, deleteForm } from '@/services/airtable/mutations-forms'
import { listSubmissions } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'

/**
 * Copy one form into a new record.
 *
 * The copy is read from STORAGE rather than from a draft the caller sent, so duplicating
 * never saves unsaved edits as a side effect, and field ids are carried through unchanged
 * because they are scoped to their own form and re-minting them would break a `showIf` that
 * points at one. `duplicatePortalFormAction` makes both calls the same way.
 *
 * It lands as a DRAFT with its own `publicId`, whatever the original's status was. The
 * public URL carries that id, so a copy that shared one would be a second form answering at
 * the first one's address, and a copy that went live on creation would put a half-edited
 * call for papers in front of strangers.
 */
export async function duplicateFormAction(input: {
  eventId: RecordId
  formId: RecordId
}): Promise<ActionResult<{ formId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadFormEditor(input.eventId, input.formId)
    if (view === undefined) throw formNotFound(input)

    const { id, eventId, publicId, kind, status, ...content } = view.form
    const created = await createForm({
      eventId: input.eventId,
      publicId: nanoid(12),
      kind: 'cfp',
      status: 'draft',
      write: { ...content, name: `${view.form.name} (copy)` },
    })

    return actionOk({ formId: created.id })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Delete one form, and refuse while anything has been submitted through it.
 *
 * That refusal is the whole reason this is not a one-line call. Airtable drops a link to a
 * deleted record silently, so deleting a form that has submissions would leave every one of
 * them pointing at nothing: the Abstracts row survives with its answers, but nothing
 * remembers which questions produced them, the Forms list stops counting it, and there is no
 * undo. Unpublishing closes a form to new submissions and keeps all of that, which is what
 * an organizer who has any actually wants; deleting is for the form created by mistake.
 */
export async function deleteFormAction(input: {
  eventId: RecordId
  formId: RecordId
}): Promise<ActionResult<{ formId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadFormEditor(input.eventId, input.formId)
    if (view === undefined) throw formNotFound(input)

    // Unpublish first, and this is not politeness. The submission count below is read
    // BEFORE the delete and Airtable has no transaction, so a speaker who passes the
    // public form's published-and-open gate can create their row in the window between
    // the two: the count sees zero, the delete lands, and the submission survives with
    // its form link silently removed and no record of what its answers were asked by.
    // That is the exact irreversible state the count exists to prevent. Refusing a
    // published form closes the window at its source, because an unpublished form
    // accepts nothing, and it leaves only the already-in-flight request an organizer
    // opened themselves by unpublishing and deleting in quick succession.
    // Found by Codex review, 2026-08-10.
    if (view.form.status === 'published') {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'This form is published, so a speaker could be filling it in right now. Unpublish it first, then delete it.',
        { formId: input.formId },
      )
    }

    const submissions = await listSubmissions(input.eventId)
    const carried = submissions.filter((submission) => submission.formId === input.formId)
    if (carried.length > 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `${carried.length === 1 ? 'A submission has' : `${String(carried.length)} submissions have`} come through this form, and deleting it would leave ${carried.length === 1 ? 'it' : 'them'} with no record of what was asked. Unpublish the form instead.`,
        { formId: input.formId, submissions: carried.length },
      )
    }

    await deleteForm({
      formId: input.formId,
      eventId: input.eventId,
      publicId: view.form.publicId,
    })

    return actionOk({ formId: input.formId })
  } catch (error) {
    return actionFailure(error)
  }
}

function formNotFound(input: { eventId: RecordId; formId: RecordId }): AppError {
  return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that form is not on this event', input)
}
