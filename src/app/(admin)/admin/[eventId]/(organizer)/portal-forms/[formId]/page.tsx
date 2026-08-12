// /admin/[eventId]/portal-forms/[formId]: the wizard in EDIT mode (refs 28-29).
//
// `notFound()` is called in the page BODY and not from inside a `<Suspense>` boundary, which is
// the rule in .claude/rules/bodo-conventions.md: a `notFound()` reached after the shell has
// flushed renders the 404 body under an HTTP 200 status line. The admin tree keeps its
// `loading.tsx` files deliberately, and that cost is recorded there: an admin `[id]` route with a
// bogus id answers 200 with the 404 body. Resolving here rather than in a child is still the
// right shape, because it is the boundary ABOVE this page that has already flushed, not one below
// it.

import { notFound } from 'next/navigation'
import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { draftFromForm } from '@/features/forms/builder/draft'
import { loadPortalFormEditor } from '@/features/portal-forms/reads'

import { PortalFormEditor } from '../PortalFormEditor'

export default async function PortalFormEditorPage({
  params,
}: {
  params: Promise<{ eventId: string; formId: string }>
}) {
  const { eventId: eventRef, formId } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isOrganizer(eventId))) return null

  // Resolved through the event's own form list AND filtered to `kind: 'task'`, so neither
  // another event's form nor a call for papers can be opened in this editor.
  const view = await loadPortalFormEditor(eventId, formId)
  if (view === undefined) notFound()

  return (
    <PortalFormEditor
      eventId={eventId}
      formId={formId}
      initialDraft={draftFromForm(view.form, view.eventTimeZone)}
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
