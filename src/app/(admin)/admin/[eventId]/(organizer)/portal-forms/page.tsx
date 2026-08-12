// /admin/[eventId]/portal-forms: ref 26's Portals > Forms list.
//
// The route is `portal-forms` and not `forms`, because `/admin/[eventId]/forms` is already the
// submission form builder. The sidebar has both entries, and since 2026-08-10 it also says which
// is which: `Submission Forms` against `Portal Forms`, where both rows used to read `Forms` and
// only the section header above them told them apart (`admin-nav-sections.ts`). The two surfaces
// read the same `Forms` table filtered by `kind`. The reference product's own path is `/event/<id>/portals/forms/<uuid>`,
// which this cannot mirror without moving every admin route under a `portals` segment.
//
// One file, no `Body` child inside `<Suspense>`: `loading.tsx` renders the same skeleton, and
// the page/body split only earns its keep where a fast header sits in front of a slow read
// (.claude/rules/bodo-conventions.md).

import { ClipboardListIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { isAppError } from '@/constants/errorIds'
import { eventRoleOf } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadPortalFormsList } from '@/features/portal-forms/reads'

import { PortalFormsBoard } from './PortalFormsBoard'

export const metadata = { title: 'Portal Forms' }

export default async function PortalFormsPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  const role = await currentRole(eventId)
  // The layout redirects an unauthorized browser. This is not the security boundary: every
  // portal form Server Action re-checks `admin` for itself.
  if (role === undefined) return null

  const view = await loadPortalFormsList(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={ClipboardListIcon}
        title="Forms"
        // Verbatim off ref 26.
        description="Create forms that can be assigned to your portals to collect information"
      />

      <PortalFormsBoard eventId={eventId} view={view} canEdit={role === 'admin'} />
    </div>
  )
}

async function currentRole(eventId: string): Promise<string | undefined> {
  try {
    return await eventRoleOf(eventId)
  } catch (error) {
    // Every AUTH_* failure means the layout is about to redirect. Anything else is a real fault
    // and must not be swallowed into an empty screen.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}
