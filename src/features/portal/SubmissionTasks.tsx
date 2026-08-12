'use client'

// The submission-scoped tasks on a detail page.
//
// BUILD_SPEC 5.2: the same `Submission Tasks` heading the home card uses, so the section
// component and the verbatim `No submission tasks found.` empty state are shared with
// the Tasks card rather than restated.
//
// Client only because the rows are collapsible. It owns nothing but the open set.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { TaskSection } from '@/features/portal/TaskSection'
import type { TaskView } from '@/features/portal/task-view'

export function SubmissionTasks({ tasks }: { tasks: readonly TaskView[] }) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())

  return (
    <TaskSection
      heading="Submission Tasks"
      tooltip="Things to do for this session. They also appear on your Tasks page."
      emptyState="No submission tasks found."
      tasks={tasks}
      openIds={openIds}
      onOpenChange={(assignmentId, open) => {
        setOpenIds((current) => {
          const next = new Set(current)
          if (open) next.add(assignmentId)
          else next.delete(assignmentId)
          return next
        })
      }}
      actions={
        tasks.length === 0 ? undefined : (
          <>
            {/* 36 and not 40, for the reason `TasksPanel` records against the same pair:
                `h-auto p-0` leaves a 16px text box, and the first task row is 18px below
                this header's centre. */}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs hit-area-[36px]"
              onClick={() => {
                setOpenIds(new Set(tasks.map((task) => task.assignmentId)))
              }}
            >
              Open All
            </Button>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs hit-area-[36px]"
              onClick={() => {
                setOpenIds(new Set())
              }}
            >
              Collapse All
            </Button>
          </>
        )
      }
    />
  )
}
