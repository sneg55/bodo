'use client'

// One row in a task section: a collapsible header with the completion control inside.
//
// Open state is owned by the panel above, not here, because `Open All` and
// `Collapse All` (ref 17) act on every row at once and a row that kept its own state
// would ignore them.

import { ChevronDownIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TaskCompletion } from '@/features/portal/TaskCompletion'
import type { TaskView } from '@/features/portal/task-view'
import { cn } from '@/utils/cn'

export type TaskItemProps = {
  task: TaskView
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskItem({ task, open, onOpenChange }: TaskItemProps) {
  // What the row shows between a stored completion and the server render that reflects it.
  //
  // The write is durable the moment the action resolves, but the badge, the section counts
  // and the control below are rendered from the SERVER's copy of the row, and the refresh
  // that fetches it is a round trip to Airtable. Until this existed the row answered
  // `Task completed.` in a toast and then went on reading `Pending` with its form still
  // open and its button still saying `Saving`, which is a successful write that looks like a
  // hang, and a control a speaker presses again. Set only from an `ok` result, so it never
  // claims a completion that did not land.
  const [justCompleted, setJustCompleted] = useState(false)
  const done = task.done || justCompleted

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-lg border border-border">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal"
            />
          }
        >
          <ChevronDownIcon
            className={cn(
              'shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{task.title}</span>
            {task.submissionLabel === undefined ? null : (
              <span className="block truncate text-xs text-muted-foreground">
                {task.submissionLabel}
              </span>
            )}
          </span>
          {task.dueLabel === undefined ? null : (
            <span className="shrink-0 text-xs text-muted-foreground">{task.dueLabel}</span>
          )}
          {task.manual ? <Badge variant="secondary">Manual</Badge> : null}
          <Badge variant={done ? 'default' : 'outline'}>{done ? 'Done' : 'Pending'}</Badge>
        </CollapsibleTrigger>

        {/* The row opens and closes on a height TRANSITION rather than snapping. Base UI
            measures the panel into `--collapsible-panel-height` and flags the two edges with
            `data-starting-style` / `data-ending-style`, which is the documented shape for
            this (node_modules/@base-ui/react/docs/react/components/collapsible.md). A
            transition and not a keyframe animation, so a speaker who changes their mind
            mid-open retargets instead of waiting the sequence out. The padding moved to the
            inner div because a panel that keeps its own padding cannot reach zero height, and
            the close is quicker than the open: attention is leaving the row. */}
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden border-t border-border transition-[height] duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-ending-style:h-0 data-ending-style:duration-150 data-starting-style:h-0">
          <div className="px-3 py-3">
            {task.description === undefined ? null : (
              <p className="mb-3 text-sm whitespace-pre-line text-muted-foreground">
                {task.description}
              </p>
            )}
            {done ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">This task is already complete.</p>
                {/* What was actually received. A finished upload task said only that it was
                    done, so a speaker who had just sent their headshot had no way to see it
                    anywhere in the portal, which reads as an upload that went nowhere. Filed
                    by the 2026-08-12 eval run. */}
                {task.completedFile === undefined ? null : (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{task.completedFile.filename}</span>
                    <span className="text-muted-foreground">{task.completedFile.sizeLabel}</span>
                    {task.completedFile.href === undefined ? null : (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 py-0"
                        render={
                          <a href={task.completedFile.href} download>
                            Download
                          </a>
                        }
                      />
                    )}
                  </p>
                )}
              </div>
            ) : (
              <TaskCompletion
                task={task}
                onCompleted={() => {
                  setJustCompleted(true)
                }}
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
