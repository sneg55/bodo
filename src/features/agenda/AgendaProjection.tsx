'use client'

// Which view the agenda's tab strip is showing, and nothing else.
//
// Split out of AgendaSurface.tsx when that file crossed the size budget. It is the right
// seam: the surface owns the STATE (the optimistic session list, the pending transition,
// the conflict report) while this owns the one decision of which projection renders, so
// the two change for different reasons. It also keeps the dynamic import of the timeline
// here, next to the only branch that uses it.

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'
import type { SavedView } from '@/types/saved-views'
import { ConflictsView } from './ConflictsView'
import type { buildConflictReport } from './conflicts'
import { AgendaListView } from './list/AgendaListView'
import { MonthView } from './MonthView'
import type { AgendaData, AgendaFocus, AgendaView, ScheduleRequest } from './types'

// Dynamic because the timeline pulls @dnd-kit in with it, and three of the six views
// never render it. Loaded at the component that needs it rather than at a layout, per
// .claude/rules/bodo-conventions.md.
const AgendaTimeline = dynamic(
  () => import('./timeline/AgendaTimeline').then((module) => module.AgendaTimeline),
  { ssr: false, loading: () => <Skeleton className="h-[38rem] w-full rounded-xl" /> },
)

export function AgendaProjection({
  view,
  data,
  report,
  isPending,
  savedViews,
  canEdit,
  focus,
  onSchedule,
  onPublication,
  onFocus,
}: {
  view: AgendaView
  data: AgendaData
  report: ReturnType<typeof buildConflictReport>
  isPending: boolean
  savedViews: readonly SavedView[]
  canEdit: boolean
  /** The session a conflict card sent the organizer to, if they came that way. */
  focus: AgendaFocus | null
  onSchedule: (change: ScheduleRequest) => void
  onPublication: (submissionIds: readonly string[], published: boolean) => void
  onFocus: (focus: AgendaFocus) => void
}) {
  if (view === 'list') {
    return (
      <AgendaListView
        data={data}
        report={report}
        isPending={isPending}
        savedViews={savedViews}
        canEdit={canEdit}
        onSchedule={onSchedule}
        onPublication={onPublication}
      />
    )
  }
  if (view === 'month') return <MonthView data={data} report={report} />
  if (view === 'conflicts') return <ConflictsView data={data} report={report} onFocus={onFocus} />
  return (
    <AgendaTimeline
      mode={view}
      data={data}
      report={report}
      isPending={isPending}
      focus={focus}
      onSchedule={onSchedule}
    />
  )
}
