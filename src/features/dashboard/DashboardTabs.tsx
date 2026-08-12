// The dashboard tab strip, ref 34: `Today` plus one tab per custom dashboard, each with its
// coloured dot, the active one underlined, and `+ Add Dashboard` right-aligned.
//
// `Tabs` from the design system rather than a hand-rolled strip, for the same reasons `SubTabs`
// gives: the primitive owns the roles, the arrow keys and the active underline, and a
// hand-written `role="tablist"` is an ESLint error here. Each trigger IS a link, because every
// tab is a URL (`nativeButton={false} render={<Link/>}`, which is this codebase's shape for a
// link that looks like a control), so Back, bookmarking and middle-click all work.
//
// Server component. The only client part is the `+ Add Dashboard` button, which owns the modal.

import Link from 'next/link'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DashboardDot } from '@/features/dashboard/DashboardDot'
import type { DashboardTab } from '@/features/dashboard/dashboard-tabs'
import { NewDashboardButton } from '@/features/dashboard/NewDashboardButton'
import { cn } from '@/utils/cn'

export function DashboardTabs({
  eventId,
  tabs,
  /** The tab id the URL selected: `today`, or a dashboard's record id. */
  active,
}: {
  eventId: string
  tabs: readonly DashboardTab[]
  active: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Tabs value={active}>
        <TabsList variant="line">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              nativeButton={false}
              render={<Link href={tab.href} />}
              // `plain-label` on the custom tabs only: their label is the dashboard's stored
              // name, which the organizer typed, and the machine-label treatment would render
              // "Speaker Tracking" as SPEAKER TRACKING. `Today` is the built-in tab and is
              // chrome, so it keeps the treatment. Same call EventSwitcher makes for an event
              // name.
              className={cn(tab.dashboardId !== undefined && 'plain-label')}
            >
              <DashboardDot color={tab.color} />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <NewDashboardButton eventId={eventId} />
    </div>
  )
}
