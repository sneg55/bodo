// What the two builder screens read. Composition over the DAL, nothing more: every
// call below is already tagged and cached where the fetch happens (read-cache.ts), so
// this file adds no caching of its own and must not.

import type { NamedOption } from '@/features/forms/builder/defaults'
import { type FormCardRow, formCardRows } from '@/features/forms/builder/list-view'
import {
  getEvent,
  listForms,
  listSubmissions,
  listTags,
  listTracks,
} from '@/services/airtable/queries'
import type { Form } from '@/types/forms'

export type FormsListView = {
  rows: readonly FormCardRow[]
  eventSlug: string
  /** For seeding a new form's Track dropdown, and for the routing rule pickers. */
  trackOptions: readonly NamedOption[]
  tagOptions: readonly NamedOption[]
}

export async function loadFormsList(eventId: string): Promise<FormsListView> {
  const [event, forms, submissions, tracks, tags] = await Promise.all([
    getEvent(eventId),
    listForms(eventId),
    listSubmissions(eventId),
    listTracks(eventId),
    listTags(eventId),
  ])

  return {
    rows: formCardRows({
      // Only the CFP forms. A portal task form is a different surface with a different
      // editor (BUILD_SPEC 5.6), and listing one here would open it in this one.
      forms: forms.filter((form) => form.kind === 'cfp'),
      submissions,
      now: new Date(),
      timeZone: event.timezone,
    }),
    eventSlug: event.slug,
    trackOptions: tracks.map((track) => ({ value: track.id, label: track.name })),
    tagOptions: tags.map((tag) => ({ value: tag.id, label: tag.name })),
  }
}

export type FormEditorView = {
  form: Form
  eventSlug: string
  /**
   * The EVENT's timezone, because a close date is a wall-clock deadline in it.
   *
   * Needed because `datetime-local` carries no zone and both the read and the write run
   * server side, where `new Date('2026-09-15T23:59')` is interpreted in the RUNTIME's zone.
   * On Workers that is UTC, so a California event's 23:59 deadline was being stored as
   * 16:59 local. Found by Codex review.
   */
  eventTimeZone: string
  trackOptions: readonly NamedOption[]
  tagOptions: readonly NamedOption[]
}

/**
 * One form, plus the event's categories and tags.
 *
 * The form is found in the event's own list rather than read by record id, which is the
 * authorization that matters here: a form id from another event cannot be opened in this
 * event's editor, so the eventId in the URL and the record being edited always agree.
 */
export async function loadFormEditor(
  eventId: string,
  formId: string,
): Promise<FormEditorView | undefined> {
  const [event, forms, tracks, tags] = await Promise.all([
    getEvent(eventId),
    listForms(eventId),
    listTracks(eventId),
    listTags(eventId),
  ])
  // Found among this event's CFP forms specifically. The LIST already filters on kind, but this
  // resolver did not, so a portal form's id typed into `/admin/<event>/forms/<id>` opened it in
  // the submission-form editor, and the save and publish actions share this resolver so they
  // accepted it too. Publishing a portal form here would have given it a `/submit/...` link it
  // cannot serve. Found by Codex review; `createTaskAction` refuses the mirror of this.
  const form = forms.find((candidate) => candidate.id === formId && candidate.kind === 'cfp')
  if (form === undefined) return undefined

  return {
    form,
    eventSlug: event.slug,
    eventTimeZone: event.timezone,
    trackOptions: tracks.map((track) => ({ value: track.id, label: track.name })),
    tagOptions: tags.map((tag) => ({ value: tag.id, label: tag.name })),
  }
}
