// The form builder's writes: create, save, publish, unpublish, delete.
//
// Two tags, always, and the second one is the one that is easy to miss. `listForms` is
// tagged `event:{id}:forms`, but the public CFP page resolves a form by the id in its URL
// and is therefore tagged `form:{publicId}` (reads.ts says why: a request's tags have to
// be set before it goes out, and the form's event is not knowable until the record has
// been read). A save that expires only the event tag leaves the public form serving the
// previous question set for the rest of its cache window, which on a live CFP means
// speakers answering questions the organizer has already removed.
//
// No fixture branch, like the other mutation modules: a write that reports success and
// stores nothing loses the form an organizer just spent twenty minutes building.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getClient } from '@/services/airtable/client'
import { invalidate, type WriteOrigin } from '@/services/airtable/invalidate'
import { mapForm } from '@/services/airtable/mapping-forms'
import { TABLES } from '@/services/airtable/tables'
import { eventFormsTag, formPublicTag } from '@/services/airtable/tags'
import {
  formContentFields,
  formStatusFields,
  type NewFormRecord,
  newFormFields,
} from '@/services/airtable/to-fields-forms'
import type { RecordId } from '@/types/domain'
import type { Form, FormContent } from '@/types/forms'

function expire(input: { eventId: RecordId; publicId: string }, origin: WriteOrigin): void {
  invalidate(origin, {
    own: [eventFormsTag(input.eventId)],
    // The public page's own cache entry. See the header note.
    others: [formPublicTag(input.publicId)],
  })
}

export async function createForm(
  input: NewFormRecord,
  origin: WriteOrigin = 'action',
): Promise<Form> {
  const created = await getClient().createRecords(TABLES.forms, [newFormFields(input)])
  const record = created.at(0)
  if (record === undefined) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'Forms: create returned no record', {
      publicId: input.publicId,
    })
  }
  expire(input, origin)
  return mapForm(record)
}

export type FormContentChange = {
  formId: RecordId
  eventId: RecordId
  publicId: string
  write: FormContent
}

/**
 * Save the whole form in one write.
 *
 * One write rather than one per step, because it is one edit: the field list, the routing
 * rules that point into it and the roles the participant step enforces are three blobs
 * that have to agree with each other. A partial save is a routing rule firing on a
 * question that the same save was supposed to add.
 */
export async function updateFormContent(
  change: FormContentChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.forms, [
    { id: change.formId, fields: formContentFields(change.write) },
  ])
  expire(change, origin)
}

export type FormStatusChange = {
  formId: RecordId
  eventId: RecordId
  publicId: string
  status: 'draft' | 'published'
}

/**
 * Publish or unpublish. A status-only write, deliberately separate from the content save:
 * publishing from the list page has no draft in hand, and sending the content columns
 * from there would write whatever the list happened to be holding.
 */
export async function setFormStatus(
  change: FormStatusChange,
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().updateRecords(TABLES.forms, [
    { id: change.formId, fields: formStatusFields(change.status) },
  ])
  expire(change, origin)
}

/**
 * Delete one form record.
 *
 * Nothing here checks what still links it, and that is the caller's job on purpose: Airtable
 * silently drops a link to a deleted record, so a `Tasks` row pointing at this form would come
 * back as a form task with no form and a speaker would meet a to-do with nothing in it. The
 * feature refuses that case (`deletePortalFormAction`) rather than this function guessing, since
 * only the caller knows which of the four tables that link a form it cares about.
 *
 * Both tags expire, exactly as an edit does: the public CFP page has its own `form:{publicId}`
 * cache entry, and leaving it would serve a deleted form for the rest of its window.
 */
export async function deleteForm(
  input: { formId: RecordId; eventId: RecordId; publicId: string },
  origin: WriteOrigin = 'action',
): Promise<void> {
  await getClient().deleteRecords(TABLES.forms, [input.formId])
  expire(input, origin)
}
