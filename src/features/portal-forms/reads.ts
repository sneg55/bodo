// What the two portal form screens read. Composition over the DAL and nothing more: every call
// below is already tagged and cached where the fetch happens (read-cache.ts), so this file adds
// no caching of its own and must not.
//
// The mirror of `@/features/forms/builder/reads`, one filter apart: that one keeps
// `kind === 'cfp'` and this one keeps `kind === 'task'`, both through `portalForms` so the rule
// is stated once.

import {
  findPortalForm,
  type PortalFormCardView,
  toPortalFormCards,
} from '@/features/portal-forms/cards'
import {
  getEvent,
  listForms,
  listTaskAssignmentsForEvent,
  listTasksForEvent,
} from '@/services/airtable/queries'
import type { RecordId } from '@/types/domain'
import type { Form } from '@/types/forms'

export type PortalFormsListView = {
  cards: readonly PortalFormCardView[]
}

/**
 * Three reads, and deliberately NOT a fourth.
 *
 * The sibling boards also read `listSubmissions`, to count the accepted cast for the
 * "Assign n to N accepted speakers" label on their bulk button. This board has no bulk button
 * (each portal form is assigned through its own task, so there is no shared fan-out a selection
 * could feed) and therefore nothing that renders the number. A fourth read would put every
 * submission on this event behind a navigation for a value nobody sees, and it would subscribe
 * the page to `event:{id}:submissions` so an unrelated accept expired it. The count the organizer
 * actually needs comes back in the assign toast, from the action that just did the fan-out.
 */
export async function loadPortalFormsList(eventId: RecordId): Promise<PortalFormsListView> {
  const [forms, tasks, items] = await Promise.all([
    listForms(eventId),
    listTasksForEvent(eventId),
    listTaskAssignmentsForEvent(eventId),
  ])

  return {
    cards: toPortalFormCards({
      forms,
      tasks,
      assignments: items.map((item) => item.assignment),
    }),
  }
}

export type PortalFormEditorView = {
  form: Form
  /**
   * The EVENT's timezone, because a close date is a wall-clock deadline in it. Same reason
   * `loadFormEditor` carries one: `datetime-local` has no zone and both ends run server side,
   * where on Workers the runtime zone is UTC.
   */
  eventTimeZone: string
  /** Whether a task already carries this form, so the editor can say it is live. */
  assigned: boolean
}

/**
 * One portal form, or undefined.
 *
 * Found in the EVENT's own form list and then filtered to `kind: 'task'`, which is the
 * authorization that matters: a form id belonging to another event cannot be opened here, and a
 * call for papers cannot be opened in this editor and saved with its routing rules and its
 * participant step wiped.
 */
export async function loadPortalFormEditor(
  eventId: RecordId,
  formId: RecordId,
): Promise<PortalFormEditorView | undefined> {
  const [event, forms, tasks] = await Promise.all([
    getEvent(eventId),
    listForms(eventId),
    listTasksForEvent(eventId),
  ])
  const form = findPortalForm(forms, formId)
  if (form === undefined) return undefined

  return {
    form,
    eventTimeZone: event.timezone,
    assigned: tasks.some((task) => task.kind === 'form' && task.formId === form.id),
  }
}
