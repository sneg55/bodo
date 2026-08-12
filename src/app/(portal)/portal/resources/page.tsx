// /portal/resources: the list of pages a speaker can open. SPEC.md R8.
//
// PRESENTATION IS AUTHORED. `docs/parity/speaker-portal.md` captures Home and Profile only,
// and there is no screenshot of a portal resources surface anywhere in `sessionboard-refs/`.
// So this reuses what that doc DID establish rather than inventing a second look: the
// `PortalFrame` shell, the `PortalCard` with its coloured header bar and icon, and the
// existing empty-state phrasing pattern. The list rows and the empty-state wording are mine.
//
// The read is inside `<Suspense>`, like every other portal page, so the pill nav and the
// card frame paint before Airtable answers.

import { BookOpenIcon } from 'lucide-react'
import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { PortalCard } from '@/features/portal/PortalCard'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { PortalResourceList } from '@/features/resources/PortalResourceList'

export const metadata = { title: 'Resources' }

export default function PortalResourcesPage() {
  return (
    <PortalFrame pageTitle="Resources" activeNav="resources">
      <PortalCard icon={BookOpenIcon} title="Resources">
        <Suspense fallback={<Skeleton className="h-32 w-full" />}>
          <PortalResourceList />
        </Suspense>
      </PortalCard>
    </PortalFrame>
  )
}
