'use server'

// The portal form builder's writes: create, save, duplicate, delete.
//
// Every one authorizes for itself with `requireEventRole(eventId, 'admin')`, and not because the
// layout fails to redirect: a Server Action is reachable by POST without any layout ever
// rendering (BUILD_SPEC 4). `reviewer` is refused deliberately, because deciding what a speaker
// has to fill in is an organizer's job.
//
// The formId is never trusted. `loadPortalFormEditor` resolves it inside the event's own form
// list AND filters to `kind: 'task'`, so a form id from another event resolves to nothing and a
// call for papers cannot be saved through this editor. The second half matters as much as the
// first: `toFormWrite` on a portal draft writes empty routing and an empty role set, which on a
// CFP form would silently unpick its category routing and its participant step.
//
// Failures come back as values rather than thrown, matching the CFP builder: a thrown AppError
// crossing the action boundary reaches the browser as a redacted digest, and "this form has no
// type yet" is something the organizer can fix once told.

import { nanoid } from 'nanoid'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { hasBlockingProblem } from '@/features/forms/builder/checks'
import { type FormDraft, normalizeFields, toFormWrite } from '@/features/forms/builder/draft'
import { missingLockedFields, withLocksRestored } from '@/features/forms/builder/field-ops'
import { checkPortalFormDraft } from '@/features/portal-forms/form-draft'
import { loadPortalFormEditor } from '@/features/portal-forms/reads'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createForm, deleteForm, updateFormContent } from '@/services/airtable/mutations-forms'
import { getEvent, listTasksForEvent } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { FormField } from '@/types/forms'

/**
 * Create a portal form and hand back its record id so the caller can open the editor on it.
 *
 * Created `published`, unlike a CFP form, and the difference is not carelessness. A CFP form is
 * created as a draft because publishing puts it on a public URL any stranger can post through.
 * A portal form has no public URL at all: the only way a speaker ever reaches one is an
 * organizer assigning it, which is the deliberate act, and the parity refs (28-29) show no
 * publish control on this editor to move the status with.
 */
export async function createPortalFormAction(input: {
  eventId: RecordId
  draft: FormDraft
}): Promise<ActionResult<{ formId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const event = await getEvent(input.eventId)
    const draft = normalizedDraft(input.draft)
    refuseBrokenDraft(draft)

    const form = await createForm({
      eventId: input.eventId,
      // Opaque and immutable. A portal form has no public URL to carry it, and it is still
      // minted: `mapForm` requires the column, and the tag the public form page is cached
      // under is keyed on it, so a blank one would be a form that shares a cache entry with
      // every other blank one.
      publicId: nanoid(12),
      kind: 'task',
      status: 'published',
      write: toFormWrite(draft, event.timezone),
    })

    return actionOk({ formId: form.id })
  } catch (error) {
    return actionFailure(error)
  }
}

/** Save the whole draft. Refuses on a blocking problem and returns every warning it found. */
export async function savePortalFormAction(input: {
  eventId: RecordId
  formId: RecordId
  draft: FormDraft
}): Promise<ActionResult<{ savedAt: string; warnings: readonly string[] }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadPortalFormEditor(input.eventId, input.formId)
    if (view === undefined) throw notOnThisEvent(input)

    // Validated in the shape it will be STORED in, not in the shape the client sent, so option
    // values that differ only in whitespace cannot pass a duplicate check and then become
    // duplicates. Same reason `saveFormAction` does it.
    // A locked library field on a portal form renders with its Delete item disabled, exactly as
    // it does on a submission form, so the same POST that ignores the disabled item is refused
    // here too. `Title` is inert on a portal form (the answer goes to `TaskAssignments`), but the
    // row is still a system field the organizer cannot remove and the two builders must not
    // disagree about that.
    const draft = withLockedFieldsKept(view.form.fields, normalizedDraft(input.draft))
    const problems = checkPortalFormDraft(draft)
    if (hasBlockingProblem(problems)) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        problems
          .filter((problem) => problem.severity === 'error')
          .map((problem) => problem.message)
          .join(' '),
        { formId: input.formId },
      )
    }

    await updateFormContent({
      formId: input.formId,
      eventId: input.eventId,
      publicId: view.form.publicId,
      write: toFormWrite(draft, view.eventTimeZone),
    })

    return actionOk({
      savedAt: new Date().toISOString(),
      warnings: problems.map((problem) => problem.message),
    })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Copy one portal form into a new record (ref 28's `Duplicate`).
 *
 * The copy is read from STORAGE rather than from a draft the caller sent, so duplicating never
 * saves unsaved edits as a side effect. Field ids are carried through unchanged: they are
 * scoped to their own form, and re-minting them would only break a `showIf` that points at one.
 */
export async function duplicatePortalFormAction(input: {
  eventId: RecordId
  formId: RecordId
}): Promise<ActionResult<{ formId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadPortalFormEditor(input.eventId, input.formId)
    if (view === undefined) throw notOnThisEvent(input)

    const { id, eventId, publicId, kind, status, ...content } = view.form
    const created = await createForm({
      eventId: input.eventId,
      publicId: nanoid(12),
      kind: 'task',
      status: 'published',
      write: { ...content, name: `${view.form.name} (copy)` },
    })

    return actionOk({ formId: created.id })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Delete one portal form (ref 28's `Delete`).
 *
 * Refused while a task still carries it, and that refusal is the whole reason this is not a
 * one-line call. Airtable drops a link to a deleted record silently, so deleting an assigned
 * form would leave every `Tasks` row that pointed at it as a form task with no form: the speaker
 * gets a to-do with no questions and no way to finish it, and the stored answers on their
 * assignment become unreadable because nothing remembers what the keys meant.
 */
export async function deletePortalFormAction(input: {
  eventId: RecordId
  formId: RecordId
}): Promise<ActionResult<{ formId: RecordId }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadPortalFormEditor(input.eventId, input.formId)
    if (view === undefined) throw notOnThisEvent(input)

    const tasks = await listTasksForEvent(input.eventId)
    const carriers = tasks.filter((task) => task.formId === input.formId)
    if (carriers.length > 0) {
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        `this form is assigned through ${carriers.length === 1 ? 'a task' : `${carriers.length} tasks`}, so deleting it would leave ${carriers.length === 1 ? 'that task' : 'those tasks'} with nothing to fill in. Delete the task first.`,
        { formId: input.formId, tasks: carriers.length },
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

/** The draft as `toFormWrite` will store it, so validation and the write cannot disagree. */
function normalizedDraft(draft: FormDraft): FormDraft {
  return { ...draft, fields: normalizeFields(draft.fields), participantFields: [] }
}

/**
 * Refuses a save that deletes a locked field, and puts back a lock that was cleared.
 *
 * The submission-form builder's own copy of this is in `@/features/forms/builder/actions`, and
 * both call the same two pure functions, so the rule is stated once.
 */
function withLockedFieldsKept(stored: readonly FormField[], draft: FormDraft): FormDraft {
  const missing = missingLockedFields(stored, draft.fields)
  if (missing.length > 0) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `${missing.map((field) => field.label).join(', ')} cannot be deleted from this form.`,
      { fieldIds: missing.map((field) => field.id) },
    )
  }
  return { ...draft, fields: withLocksRestored(stored, draft.fields) }
}

/** Everything a create refuses on, which is step 1's two required fields. */
function refuseBrokenDraft(draft: FormDraft): void {
  const problems = checkPortalFormDraft(draft)
  if (!hasBlockingProblem(problems)) return
  throw new AppError(
    ErrorIds.SUB_VALIDATION_FAIL,
    problems
      .filter((problem) => problem.severity === 'error')
      .map((problem) => problem.message)
      .join(' '),
    {},
  )
}

function notOnThisEvent(input: { eventId: RecordId; formId: RecordId }): AppError {
  return new AppError(
    ErrorIds.DATA_RECORD_NOT_FOUND,
    'that portal form is not on this event',
    input,
  )
}
