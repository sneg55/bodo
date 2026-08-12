// /admin/[eventId]/forms: the Submission Forms list (parity ref 05).
//
// One file, not a shell plus a body inside `<Suspense>`: that split existed only because
// `cacheComponents` refused a page body that awaited `params`, and `loading.tsx` next door
// is the boundary that lets the admin chrome paint while this reads.

import { ClipboardListIcon } from 'lucide-react'
import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadFormsList } from '@/features/forms/builder/reads'

import { FormsListPanel } from './FormsListPanel'

export default async function FormsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)
  // The layout redirects an unauthorized browser. This is not the security boundary:
  // every builder Server Action re-checks the role for itself. BUILD_SPEC 4.
  if (!(await isOrganizer(eventId))) return null

  const view = await loadFormsList(eventId)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ClipboardListIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Submission Forms</h1>
          <p className="text-sm text-muted-foreground">
            Collect abstract, session and participant information for your event
          </p>
        </div>
      </header>

      <FormsListPanel eventId={eventId} eventSlug={view.eventSlug} rows={view.rows} />
    </div>
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
