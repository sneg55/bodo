// /admin/[eventId]/portal-forms/new: the wizard in CREATE mode (ref 27).
//
// A static segment rather than a sentinel id in `[formId]`, so Next resolves it before the
// dynamic route and no id could ever collide with it.
//
// No record exists yet, so the draft lives in the browser until `Create` posts it. That is what
// makes ref 27's header (`Create Form` plus a `Create` button) and its disabled steps 2 and 3
// honest rather than decorative: there is genuinely nothing for a question to belong to.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { newPortalFormDraft } from '@/features/portal-forms/form-draft'

import { PortalFormEditor } from '../PortalFormEditor'

export const metadata = { title: 'Create Form' }

export default async function NewPortalFormPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  if (!(await isOrganizer(eventId))) return null

  return <PortalFormEditor eventId={eventId} initialDraft={newPortalFormDraft()} />
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
