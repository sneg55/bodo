// The agenda's read, kept in its own component so page.tsx can render it inside
// `<Suspense>` and paint the header first.
//
// The saved views and the acting role are read alongside the schedule rather than inside
// the client surface: both are server data, the memberships read is already cached for this
// request, and `Promise.all` keeps them off the critical path of each other. `canEdit` only
// decides which controls render; every Saved Views write authorizes for itself
// (`@/features/views/actions`).

import { AgendaSurface } from '@/features/agenda/AgendaSurface'
import { getAgendaData } from '@/features/agenda/read-model'
import { eventRoleOf } from '@/features/auth/wiring'
import { listSavedViews } from '@/services/airtable/queries'
import { AGENDA_LIST_SURFACE } from '@/types/saved-views'

export async function AgendaPageBody({ eventId }: { eventId: string }) {
  const [data, savedViews, role] = await Promise.all([
    getAgendaData(eventId),
    listSavedViews(eventId, AGENDA_LIST_SURFACE),
    eventRoleOf(eventId),
  ])

  return <AgendaSurface data={data} savedViews={savedViews} canEdit={role === 'admin'} />
}
