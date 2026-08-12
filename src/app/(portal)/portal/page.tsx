// Portal home (ref 17): My Submissions and My Profile side by side, roughly 60/40,
// then a full-width Tasks card.
//
// The page body reads nothing. Each card does its own read inside a `<Suspense>` boundary,
// so the three-card layout is drawn immediately and each card fills in on its own instead
// of the slowest read holding up the page.

import { Suspense } from 'react'

import { MyProfileCard } from '@/features/portal/MyProfileCard'
import { MySubmissionsCard, MySubmissionsCardFallback } from '@/features/portal/MySubmissionsCard'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { RequestedFilesCard } from '@/features/portal/RequestedFilesCard'
import { SubscribeCalendarCard } from '@/features/portal/SubscribeCalendarCard'
import { TasksCard } from '@/features/portal/TasksCard'

export const metadata = { title: 'Home' }

export default function PortalHomePage() {
  return (
    <PortalFrame pageTitle="Home" activeNav="home">
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {/* The count is in this card's header, so the header streams with the rows.
                The fallback is the same card frame, not a bare skeleton. */}
            <Suspense fallback={<MySubmissionsCardFallback />}>
              <MySubmissionsCard />
            </Suspense>
          </div>
          <div className="lg:col-span-2">
            <MyProfileCard />
          </div>
        </div>
        <TasksCard />
        {/* A fourth card, below Tasks, and authored: see RequestedFilesCard.tsx for why the
            speaker half of R6's file requests lives here rather than behind a sixth nav pill. */}
        <RequestedFilesCard />
        {/* Behind its own boundary and last, because it is the only card here that reads the
            embeds table: nothing else on this page should wait on it. It renders nothing at
            all when the organizer has published no feed, so the fallback is `null` rather
            than a skeleton for a card that may never arrive. */}
        <Suspense fallback={null}>
          <SubscribeCalendarCard />
        </Suspense>
      </div>
    </PortalFrame>
  )
}
