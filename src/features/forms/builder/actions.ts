'use server'

// The form builder's writes.
//
// Every one of them authorizes for itself with `requireEventRole(eventId, 'admin')`, and
// not because the layout does not: a Server Action is reachable by POST without the
// layout ever rendering, and building or publishing a call for papers is an organizer's
// job (BUILD_SPEC section 4).
//
// The eventId is re-derived, never trusted. `loadFormEditor` finds the form in the
// event's own list, so a formId belonging to another event resolves to nothing here
// rather than being saved against the event in the URL.
//
// Failures come back as values rather than thrown: a thrown AppError crossing the action
// boundary reaches the browser as a redacted digest, and "a routing rule points at a
// category that no longer exists" is something the organizer can fix once told.

import { nanoid } from 'nanoid'

import { AppError, ErrorIds } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { checkDraft, hasBlockingProblem, publishBlockers } from '@/features/forms/builder/checks'
import { NEW_FORM_ID_COUNT, newFormDraft } from '@/features/forms/builder/defaults'
import {
  draftFromForm,
  type FormDraft,
  normalizeFields,
  toFormWrite,
} from '@/features/forms/builder/draft'
import { missingLockedFields, withLocksRestored } from '@/features/forms/builder/field-ops'
import { type FormEditorView, loadFormEditor } from '@/features/forms/builder/reads'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { createForm, setFormStatus, updateFormContent } from '@/services/airtable/mutations-forms'
import { getEvent, listTags, listTracks } from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'

/** The default name a new form gets, matching the product's "Submission Form" cards. */
const NEW_FORM_NAME = 'Submission Form'

/**
 * Create a form and hand back its record id so the caller can open the editor on it.
 *
 * Created as a DRAFT. Publishing is a separate, deliberate act: a form that goes public
 * the moment it is created is a call for papers nobody has read yet, reachable by anyone
 * with the event slug.
 */
export async function createFormAction(input: {
  eventId: RecordId
}): Promise<ActionResult<{ formId: RecordId; publicId: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadNewFormContext(input.eventId)
    const draft = newFormDraft({
      name: NEW_FORM_NAME,
      ids: Array.from({ length: NEW_FORM_ID_COUNT }, () => nanoid(10)),
      trackOptions: view.trackOptions,
      tagOptions: view.tagOptions,
    })

    const form = await createForm({
      eventId: input.eventId,
      // Opaque and immutable: it is what the public CFP URL carries, so it needs no
      // collision policy, no rename handling and no reserved-word list.
      publicId: nanoid(12),
      // This builder makes calls for papers only. A portal task form is its own surface
      // (BUILD_SPEC 5.6) and creates its record through `@/features/portal-forms/actions`.
      kind: 'cfp',
      status: 'draft',
      write: toFormWrite(draft, view.eventTimeZone),
    })

    return actionOk({ formId: form.id, publicId: form.publicId })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Save the whole draft. Refuses on a blocking problem and reports every one it found.
 *
 * It used to return the warnings too, and the editor toasted one per warning per save.
 * That is gone rather than moved: the editor runs the same `checkDraft` over its live
 * draft and renders every problem on the step that owns it (`StepProblems`), so returning
 * the same list here would be a second copy of an answer the client already has, arriving
 * as a toast the organizer cannot act on from wherever they pressed Save. The CFP-02
 * evaluation found that shape on the close-date save. Errors still travel back, as the
 * refusal below.
 */
export async function saveFormAction(input: {
  eventId: RecordId
  formId: RecordId
  draft: FormDraft
}): Promise<ActionResult<{ savedAt: string }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadFormEditor(input.eventId, input.formId)
    if (view === undefined) throw formNotFound(input)

    // Validated in the shape it will be STORED in, not in the shape the client sent. Saving
    // trims option values and drops empty ones, so validating the raw draft let two values
    // that differ only in whitespace pass a duplicate check and then become duplicates.
    // Found by Codex review.
    // A locked system field cannot be deleted or quietly demoted. Refused here as well as in
    // the editor, because the editor refusing it is not a check on a POST: see the note on
    // `missingLockedFields`.
    const draft = withLockedFieldsKept(view.form, normalizedDraft(input.draft))
    // A field that already exists must keep the registryKey it already has. That key is the
    // only thing routing an answer into a typed column, and this action takes the whole
    // draft from the client, so nothing else stops a caller stripping one off a library
    // field and silently sending every future answer to answersJson instead. The editor
    // never does this; a direct POST could.
    reconcileRegistryKeys(view.form, draft)

    const problems = checkDraft(
      draft,
      view.trackOptions.map((option) => option.value),
      view.tagOptions.map((option) => option.value),
    )
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

    return actionOk({ savedAt: new Date().toISOString() })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Publish or unpublish.
 *
 * Publishing re-runs the checks, because the public page renders whatever is stored and
 * a draft is allowed to be half-built: this is the moment the half-built version becomes
 * something a stranger can submit through.
 */
export async function setFormStatusAction(input: {
  eventId: RecordId
  formId: RecordId
  status: 'draft' | 'published'
}): Promise<ActionResult<{ status: 'draft' | 'published' }>> {
  try {
    await requireEventRole(input.eventId, 'admin')
    const view = await loadFormEditor(input.eventId, input.formId)
    if (view === undefined) throw formNotFound(input)

    if (input.status === 'published') refusePublishingBrokenForm(view)

    await setFormStatus({
      formId: input.formId,
      eventId: input.eventId,
      publicId: view.form.publicId,
      status: input.status,
    })

    return actionOk({ status: input.status })
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Checked against what is STORED, not against a draft the caller sent, because publish
 * is reachable from the list page where there is no draft in hand.
 *
 * A STRICTER gate than the save, and that difference is the CFP-15 twin defect. Save refuses
 * only errors, so a form offering options the column behind them cannot store went public on
 * a warning the organizer could click past, and every answer to one of those options was
 * then dropped without anything saying so. Publish is the last moment that is still the
 * organizer's problem rather than a speaker's, so it refuses those warnings too
 * (`publishBlockers`, and `blocksPublish` in problem.ts for which ones and why).
 */
function refusePublishingBrokenForm(view: FormEditorView): void {
  const problems = checkDraft(
    draftFromForm(view.form, view.eventTimeZone),
    view.trackOptions.map((option) => option.value),
    view.tagOptions.map((option) => option.value),
  )
  const blockers = publishBlockers(problems)
  if (blockers.length === 0) return
  throw new AppError(
    ErrorIds.DATA_WRITE_FAIL,
    `This form cannot be published yet. ${blockers.map((problem) => problem.message).join(' ')}`,
    { formId: view.form.id },
  )
}

async function loadNewFormContext(eventId: RecordId): Promise<{
  /** The event's zone, in which a close date is a wall-clock deadline. See draft.ts. */
  eventTimeZone: string
  trackOptions: readonly { value: string; label: string }[]
  tagOptions: readonly { value: string; label: string }[]
}> {
  const [event, tracks, tags] = await Promise.all([
    getEvent(eventId),
    listTracks(eventId),
    listTags(eventId),
  ])
  return {
    eventTimeZone: event.timezone,
    trackOptions: tracks.map((track) => ({ value: track.id, label: track.name })),
    tagOptions: tags.map((tag) => ({ value: tag.id, label: tag.name })),
  }
}

/** The draft as `toFormWrite` will store it, so validation and the write cannot disagree. */
function normalizedDraft(draft: FormDraft): FormDraft {
  return {
    ...draft,
    fields: normalizeFields(draft.fields),
    participantFields: normalizeFields(draft.participantFields),
  }
}

/**
 * Refuses a save that DELETES a locked system field, and puts back a lock that was cleared.
 *
 * Compared against the stored form, which is the only trustworthy copy, exactly as
 * `reconcileRegistryKeys` below is. The message names the fields so the organizer is told
 * which row came back rather than being silently corrected.
 */
function withLockedFieldsKept(stored: Form, draft: FormDraft): FormDraft {
  const missing = [
    ...missingLockedFields(stored.fields, draft.fields),
    ...missingLockedFields(stored.participantFields, draft.participantFields),
  ]
  if (missing.length > 0) {
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      `${missing.map((field) => field.label).join(', ')} cannot be deleted from this form.`,
      { formId: stored.id, fieldIds: missing.map((field) => field.id) },
    )
  }

  return {
    ...draft,
    fields: withLocksRestored(stored.fields, draft.fields),
    participantFields: withLocksRestored(stored.participantFields, draft.participantFields),
  }
}

/**
 * Refuses a save that changes or drops the `registryKey` of a field that already exists.
 *
 * Compared by field id against the STORED form, which is the only trustworthy copy. A key
 * appearing on a field that did not have one is allowed, because adding a library field is
 * an ordinary edit; changing or removing one is not, and it is indistinguishable from an
 * ordinary save in its effects until submissions start arriving with empty columns.
 */
function reconcileRegistryKeys(stored: Form, draft: FormDraft): void {
  const storedKeys = new Map(
    [...stored.fields, ...stored.participantFields].map((field) => [field.id, field.registryKey]),
  )

  for (const field of [...draft.fields, ...draft.participantFields]) {
    const was = storedKeys.get(field.id)
    if (was === undefined) continue
    if (field.registryKey === was) continue
    throw new AppError(
      ErrorIds.DATA_WRITE_FAIL,
      'a question cannot change which stored field it writes to',
      { formId: stored.id, fieldId: field.id, was, now: field.registryKey },
    )
  }
}

function formNotFound(input: { eventId: RecordId; formId: RecordId }): AppError {
  return new AppError(ErrorIds.DATA_RECORD_NOT_FOUND, 'that form is not on this event', input)
}
