// /admin/[eventId]/tasks
//
// Two surfaces on one route, and the route is BUILD_SPEC 5.6's ("Dashboard
// (`/admin/[eventId]/tasks`)") while the upper half is ref 25's Tasks list from
// docs/parity/portal-tasks-forms.md. They are stacked rather than put behind a second tab
// strip because ref 25 already spends its tab strip on the four type tabs, and moving those
// down a level to make room would be the familiarity regression the parity doc outranks
// BUILD_SPEC to prevent.
//
// One file, no `TasksBody` child inside `<Suspense>`: `loading.tsx` renders the same
// skeleton, and the page/body split only earns its keep where a fast header sits in front of
// a slow read (.claude/rules/bodo-conventions.md).

import { CheckSquareIcon } from 'lucide-react'
import { PageHeader } from '@/components/primitives/PageHeader'
import { isAppError } from '@/constants/errorIds'
import { eventRoleOf } from '@/features/auth/wiring'
import { requireEventId } from '@/features/events/resolve-ref'
import { loadTasksAdminView } from '@/features/tasks/admin-view'

import { TasksBoard } from './TasksBoard'

export default async function TasksPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: eventRef } = await params
  const eventId = await requireEventId(eventRef)

  const role = await currentRole(eventId)
  // The layout redirects an unauthorized browser. This is not the security boundary:
  // `createTaskAction` and `assignTasksAction` both re-check `admin` for themselves.
  if (role === undefined) return null

  const view = await loadTasksAdminView(eventId)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        icon={CheckSquareIcon}
        title="Tasks"
        description="Create tasks that can be assigned to your portals"
      />

      <TasksBoard eventId={eventId} view={view} canEdit={role === 'admin'} />
    </div>
  )
}

async function currentRole(eventId: string): Promise<string | undefined> {
  try {
    return await eventRoleOf(eventId)
  } catch (error) {
    // Every AUTH_* failure means the layout is about to redirect. Anything else is a real
    // fault and must not be swallowed into an empty screen.
    if (isAppError(error) && error.id.startsWith('E_AUTH')) return undefined
    throw error
  }
}
