'use client'

// Ref 25's Tasks list, then the onboarding status table underneath it.
//
// Search, tabs and selection are local state. There is no server-side filtering to drive
// here: an event's task list is a handful of rows and the whole set is already in this page's
// payload, so a URL query string would cost a round trip to filter what the browser holds.
// AbstractsTable puts its query in the URL for the opposite reason, and both are right.
//
// Assigning is a bulk action because that is what the R6 acceptance criterion asks for: a
// three-task checklist to the accepted set in one go. The kebab on each card assigns that one
// task, for the same set.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assignTasksAction } from '@/features/tasks/actions'
import type { TasksAdminView } from '@/features/tasks/admin-view'
import { filterTaskCards, type TaskTab } from '@/features/tasks/cards'

import { AddTaskButton } from './AddTaskButton'
import { AssignSpeakersDialog } from './AssignSpeakersDialog'
import { OnboardingStatus } from './OnboardingStatus'
import { TaskCard } from './TaskCard'

export function TasksBoard({
  eventId,
  view,
  canEdit,
}: {
  eventId: string
  view: TasksAdminView
  /** A reviewer can read this surface. Both writes require `admin` regardless. */
  canEdit: boolean
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TaskTab>('all')
  const [selected, setSelected] = useState<readonly string[]>([])
  const [pending, startTransition] = useTransition()

  const visible = filterTaskCards(view.cards, tab, search)

  const assign = (taskIds: readonly string[]) => {
    startTransition(async () => {
      const result = await assignTasksAction({ eventId, taskIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setSelected([])
      toast.success(
        result.created === 0
          ? 'Already assigned'
          : `Assigned ${result.created} ${result.created === 1 ? 'task' : 'tasks'} across ${result.speakers} ${result.speakers === 1 ? 'speaker' : 'speakers'}`,
        {
          description:
            result.skipped === 0
              ? undefined
              : `${result.skipped} already had a row and were left alone.`,
        },
      )
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            value={search}
            placeholder="Search tasks..."
            className="max-w-sm"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex items-center gap-2">
            {selected.length === 0 ? null : (
              <>
                <Button
                  variant="outline"
                  disabled={!canEdit || pending}
                  onClick={() => assign(selected)}
                >
                  Assign {selected.length} to {view.acceptedSpeakers} accepted{' '}
                  {view.acceptedSpeakers === 1 ? 'speaker' : 'speakers'}
                </Button>
                {/* SPK-09. The other half of the accepted-cohort shortcut beside it, for a
                    task that already exists: until this landed, putting one on a keynote
                    invited over email meant deleting it and making it again through Add Task.
                    Both go through the same planner, so neither can drift about what a row is. */}
                <AssignSpeakersDialog
                  eventId={eventId}
                  cards={view.cards}
                  taskIds={selected}
                  disabled={!canEdit || pending}
                  onAssigned={() => setSelected([])}
                />
              </>
            )}
            <AddTaskButton eventId={eventId} forms={view.forms} disabled={!canEdit} />
          </div>
        </div>

        <Tabs value={tab} onValueChange={(next: string) => setTab(next as TaskTab)}>
          <TabsList variant="line" className="group-data-horizontal/tabs:h-auto min-h-8 flex-wrap">
            {view.tabs.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
                <Badge variant="secondary">{entry.count}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="font-medium">No tasks yet</p>
            <p className="text-sm text-muted-foreground">
              Create a task to collect information from participants
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((card) => (
              <TaskCard
                key={card.id}
                card={card}
                selected={selected.includes(card.id)}
                disabled={!canEdit || pending}
                onSelectedChange={(next) =>
                  setSelected((current) =>
                    next ? [...current, card.id] : current.filter((id) => id !== card.id),
                  )
                }
                onAssign={() => assign([card.id])}
              />
            ))}
          </div>
        )}
      </div>

      {/* `canEdit` is the event `admin` role, which is also what entering the portal as a
          speaker requires: a reviewer may read this board and neither assign work nor act
          as somebody. The action re-checks it regardless. */}
      <OnboardingStatus
        rows={view.progress}
        totals={view.totals}
        eventId={eventId}
        canImpersonate={canEdit}
      />
    </div>
  )
}
