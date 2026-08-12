// /admin/[eventId]/forms/[formId]: the seven-step form editor (parity refs 06-15).

import { notFound } from 'next/navigation'
import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { draftFromForm } from '@/features/forms/builder/draft'
import { loadFormEditor } from '@/features/forms/builder/reads'
import { readTeamMembers } from '@/features/team/reads'
import { recipientOptions } from '@/features/team/recipients'

import { FormEditor } from './FormEditor'

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ eventId: string; formId: string }>
}) {
  const { eventId: eventRef, formId } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isOrganizer(eventId))) return null

  // Resolved through the event's own form list, so a form id from another event is a 404
  // here rather than an editor pointed at somebody else's record.
  //
  // The team is read here rather than inside `loadFormEditor`, which the save and publish
  // actions also call: those two do not render the recipient picker, and a read they cannot
  // use is a read on every save.
  const [view, team] = await Promise.all([
    loadFormEditor(eventId, formId),
    readTeamMembers(eventId),
  ])
  if (view === undefined) notFound()

  return (
    <FormEditor
      eventId={eventId}
      formId={formId}
      eventTimeZone={view.eventTimeZone}
      eventSlug={view.eventSlug}
      publicId={view.form.publicId}
      status={view.form.status}
      initialDraft={draftFromForm(view.form, view.eventTimeZone)}
      trackOptions={view.trackOptions}
      tagOptions={view.tagOptions}
      recipients={recipientOptions(team)}
    />
  )
}

async function isOrganizer(eventId: string): Promise<boolean> {
  try {
    await requireEventRole(eventId, 'admin')
    return true
  } catch (error) {
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return false
    throw error
  }
}
