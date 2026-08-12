'use client'

// A task section: the heading with its info tooltip, an optional right-aligned control
// pair, the rows, and the empty state.
//
// Ref 17 gives two of these, `Submission Tasks` and `My Tasks`, "each with a circled-i
// info icon", and the two empty states are transcribed verbatim there. Note that
// `No submission tasks found.` ends in a period and `No tasks found` does not: that is
// what the screenshot shows, and familiarity is scored, so it is not tidied up.
//
// The tooltip copy itself is authored. The parity audit lists "info tooltip copy behind
// the circled-i icons" as an unresolved ambiguity, so there is nothing to transcribe.

import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TaskItem } from '@/features/portal/TaskItem'
import type { TaskView } from '@/features/portal/task-view'
import { cn } from '@/utils/cn'

export type TaskSectionProps = {
  heading: string
  tooltip: string
  emptyState: string
  tasks: readonly TaskView[]
  openIds: ReadonlySet<string>
  onOpenChange: (assignmentId: string, open: boolean) => void
  /** `Open All` and `Collapse All`, rendered on the first section only (ref 17). */
  actions?: ReactNode
}

export function TaskSection({
  heading,
  tooltip,
  emptyState,
  tasks,
  openIds,
  onOpenChange,
  actions,
}: TaskSectionProps) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">{heading}</h3>
        <Tooltip>
          {/* A Button and not the bare icon: an <svg> is not focusable, so a
              tooltip hung off one is unreachable by keyboard. */}
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                // 20px visible. The header row is 20px tall and `space-y-2` puts the first
                // task row 8px under it, so there are only 18px between this centre and the
                // next pressable thing: 36 is the largest square that reaches it without
                // crossing it.
                className="size-5 hit-area-[36px]"
                aria-label={`About ${heading}`}
              >
                <InfoIcon className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>

      {tasks.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{emptyState}</p>
      ) : (
        <div
          className={cn(
            'space-y-2',
            // The rows are what the Suspense skeleton above them was standing in for, so
            // their arrival is a real enter and not a page load: they come in one after
            // another instead of as one block. Capped at three steps, because a speaker with
            // a dozen tasks should not be waiting on the twelfth, and `fill-mode-backwards`
            // is what holds a delayed row at its start frame rather than letting it sit
            // visible until its turn.
            '[&>*]:animate-in [&>*]:fade-in-0 [&>*]:slide-in-from-top-1 [&>*]:fill-mode-backwards [&>*]:duration-300 [&>*]:ease-[cubic-bezier(0.2,0,0,1)]',
            '[&>*:nth-child(2)]:[animation-delay:100ms] [&>*:nth-child(3)]:[animation-delay:200ms] [&>*:nth-child(n+4)]:[animation-delay:300ms]',
          )}
        >
          {tasks.map((task) => (
            <TaskItem
              key={task.assignmentId}
              task={task}
              open={openIds.has(task.assignmentId)}
              onOpenChange={(open) => {
                onOpenChange(task.assignmentId, open)
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
