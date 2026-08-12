// /portal/profile (ref 18): the initials-avatar header, the `Profile Info` control, and
// the collapsible General and My Links panels.
//
// Body static, dynamic half inside the boundary, as everywhere else in this tree.

import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { ProfileBody } from '@/features/portal/ProfileBody'

export const metadata = { title: 'Profile' }

export default function PortalProfilePage() {
  return (
    <PortalFrame pageTitle="Profile" activeNav="profile">
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-16 w-64" />
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-80 w-full lg:col-span-2" />
              <Skeleton className="h-80 w-full" />
            </div>
          </div>
        }
      >
        <ProfileBody />
      </Suspense>
    </PortalFrame>
  )
}
