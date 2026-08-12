// /portal/tasks: the Tasks pill's own page.
//
// Same panel as the home card, so the tabs, the Filter dropdown, the two sections with
// their info tooltips, `Open All`, `Collapse All` and both verbatim empty states are the
// shared component rather than a second implementation that could drift from it.

import { BriefcaseIcon } from 'lucide-react'
import { Suspense } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { PortalCard } from '@/features/portal/PortalCard'
import { PortalFrame } from '@/features/portal/PortalFrame'
import { TasksBody } from '@/features/portal/TasksCard'

export const metadata = { title: 'Tasks' }

export default function PortalTasksPage() {
  return (
    <PortalFrame pageTitle="Tasks" activeNav="tasks">
      <PortalCard icon={BriefcaseIcon} title="Tasks">
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <TasksBody />
        </Suspense>
      </PortalCard>
    </PortalFrame>
  )
}
