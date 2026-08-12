// /portal/submissions: where `View All` on the home card goes.
//
// Not in the screenshot set (the parity audit lists it as uncaptured), so BUILD_SPEC 5.2
// specifies it: the same card as the home card, newest first, with the pill nav's
// `Submissions` tab active.

import { CalendarIcon } from 'lucide-react'
import { Suspense } from 'react'

import { PortalCard } from '@/features/portal/PortalCard'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { SubmissionsList, SubmissionsListSkeleton } from '@/features/portal/SubmissionsList'

export const metadata = { title: 'Submissions' }

export default function PortalSubmissionsPage() {
  return (
    <PortalFrame pageTitle="Submissions" activeNav="submissions">
      <PortalCard icon={CalendarIcon} title="My Submissions">
        <Suspense fallback={<SubmissionsListSkeleton />}>
          <SubmissionsList />
        </Suspense>
      </PortalCard>
    </PortalFrame>
  )
}
