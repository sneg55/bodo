'use client'

// The Tasks card body, and the whole of /portal/tasks.
//
// Control inventory from ref 17, verbatim: tabs `All`, `My Tasks (<n>)`,
// `Submissions (<n>)` with the active one underlined; a right-aligned funnel-icon
// `Filter` dropdown; sections `Submission Tasks` and `My Tasks`, each with an info
// tooltip; `Open All` and `Collapse All`; and the two empty states.
//
// One client component for the whole interactive surface, taking a flat array of
// already-formatted rows. Tabs, the filter and the open set are the only state, and
// none of it belongs on the server: switching a tab must not cost a round trip.
//
// The `Filter` options are authored. The parity audit lists the dropdown's contents as
// an unresolved ambiguity, so the three states the data can actually express are
// offered rather than inventing a taxonomy.

import { ChevronDownIcon, FilterIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskSection } from '@/features/portal/TaskSection'
import type { TaskFilter } from '@/features/portal/task-groups'
import type { TaskView } from '@/features/portal/task-view'

const SUBMISSION_TASKS_TOOLTIP =
  'Things to do for one of your sessions. They appear on that submission as well.'
const MY_TASKS_TOOLTIP = 'Things to do that are about you rather than about one session.'

const FILTER_LABELS: ReadonlyMap<TaskFilter, string> = new Map([
  ['all', 'All'],
  ['outstanding', 'Outstanding'],
  ['completed', 'Completed'],
])

type TabId = 'all' | 'mine' | 'submission'

export function TasksPanel({ tasks }: { tasks: readonly TaskView[] }) {
  const [tab, setTab] = useState<TabId>('all')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())

  const visible = useMemo(() => applyFilter(tasks, filter), [tasks, filter])
  const mine = visible.filter((task) => task.scope === 'mine')
  const submission = visible.filter((task) => task.scope === 'submission')

  // Counts come off the unfiltered set: they label the tab, and a tab whose count
  // changed when the Filter menu moved would be describing the filter, not the tab.
  const counts = {
    mine: tasks.filter((task) => task.scope === 'mine').length,
    submission: tasks.filter((task) => task.scope === 'submission').length,
  }

  function toggle(assignmentId: string, open: boolean): void {
    setOpenIds((current) => {
      const next = new Set(current)
      if (open) next.add(assignmentId)
      else next.delete(assignmentId)
      return next
    })
  }

  const openAll = () => {
    setOpenIds(new Set(visible.map((task) => task.assignmentId)))
  }
  const collapseAll = () => {
    setOpenIds(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId)
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="mine">{`My Tasks (${String(counts.mine)})`}</TabsTrigger>
            <TabsTrigger value="submission">
              {`Submissions (${String(counts.submission)})`}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // 28px tall and already wide, so the band and not the square. It only grows
              // 6px each way, and the nearest neighbour in that direction is the tab strip
              // 12px off across the row's `gap-3` once this wraps under it.
              <Button variant="ghost" size="sm" className="ml-auto font-normal hit-area-y">
                {/* `data-icon` is what the button's size variant watches to tighten the
                    padding on the side an icon sits on: an icon carries less visual weight
                    than a glyph, so equal padding reads as the icon being pushed outward.
                    Both ends here, since the caret is trailing. */}
                <FilterIcon data-icon="inline-start" />
                Filter
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {/* A radio group and not plain items with a text tick: the menu picks ONE
                filter, so the check belongs to the primitive, which reserves the gutter
                for it (labels stop shifting when the selection moves) and reports the
                choice to assistive tech instead of hiding it in the label string. */}
            <DropdownMenuRadioGroup
              value={filter}
              onValueChange={(value) => {
                setFilter(value as TaskFilter)
              }}
            >
              {[...FILTER_LABELS].map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {tab === 'mine' ? null : (
        <TaskSection
          heading="Submission Tasks"
          tooltip={SUBMISSION_TASKS_TOOLTIP}
          emptyState="No submission tasks found."
          tasks={submission}
          openIds={openIds}
          onOpenChange={toggle}
          actions={
            <>
              {/* `h-auto p-0` collapses these to their 16px text box. They sit in the same
                  20px header row as the info icon, 18px above the first task row, so 36 is
                  the largest square that reaches it without crossing it. Square rather than
                  `hit-area-y` for that reason: a full 40px band would cross the row below. */}
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs hit-area-[36px]"
                onClick={openAll}
              >
                Open All
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs hit-area-[36px]"
                onClick={collapseAll}
              >
                Collapse All
              </Button>
            </>
          }
        />
      )}

      {tab === 'submission' ? null : (
        <TaskSection
          heading="My Tasks"
          tooltip={MY_TASKS_TOOLTIP}
          emptyState="No tasks found"
          tasks={mine}
          openIds={openIds}
          onOpenChange={toggle}
        />
      )}
    </div>
  )
}

/**
 * Duplicated from `applyTaskFilter` in ./task-groups on purpose: that one filters
 * `PortalTaskItem` on the server, this one filters the flattened `TaskView` in the
 * browser, and importing the server module here would pull the Task record types into
 * the client bundle for the sake of one predicate.
 */
function applyFilter(tasks: readonly TaskView[], filter: TaskFilter): readonly TaskView[] {
  if (filter === 'outstanding') return tasks.filter((task) => !task.done)
  if (filter === 'completed') return tasks.filter((task) => task.done)
  return tasks
}
