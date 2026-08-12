'use client'

// "Add Task": the right drawer behind ref 25's `+ Add` > `Add Task`.
//
// The parity doc lists this drawer's contents under Ambiguities, so its shape is taken from
// the Add File Request drawer on ref 31, which is captured, and the fields that are
// task-specific (`Kind`, `Due date`, `Form`, `Assign to`) are invented. Reasoning and the
// deviation are recorded in src/features/tasks/task-draft.ts rather than repeated here.
//
// Two documented deviations from ref 31, both the same call AddAbstractSheet.tsx already
// made and for the same reason: Instructions is a `Textarea` rather than a rich text editor,
// because the shared RichTextEditor primitive does not exist yet and wiring a second TipTap
// instance here is the forked-primitive mistake BUILD_SPEC 5.0 warns about; and Due date is
// an `Input type="datetime-local"` rather than a Calendar in a Popover, because the shared
// date-time control belongs in primitives and react-day-picker inside a drawer would ship a
// calendar in order to open a form.
//
// CREATE THEN ASSIGN, as two writes and deliberately not one. `createTaskAction` defines the
// task and `assignTasksToSpeakersAction` gives it to the speakers picked below, which is the
// same pair of actions the board's own Assign button uses from the other end. A combined
// action would be a third path to `TaskAssignments` rows, and the reason there are only two
// is that both go through `planAssignments`, so neither can invent a row shape the other
// does not make. If the assignment half fails, the TASK STILL EXISTS and the drawer says so
// rather than claiming nothing happened: it is on the board and can be assigned from there.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { DateKeyField } from '@/components/primitives/DateKeyField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { TaskEntityType } from '@/constants/status'
import { assignTasksToSpeakersAction, createTaskAction } from '@/features/tasks/actions'
import type { TaskFormOption } from '@/features/tasks/admin-view'
import {
  EMPTY_TASK_DRAFT,
  isTaskDraftValid,
  TASK_TITLE_MAX,
  TASK_TYPE_CARDS,
  type TaskDraft,
  toCreateTaskInput,
} from '@/features/tasks/task-draft'
import { cn } from '@/utils/cn'

import { AssignSpeakersField } from './AssignSpeakersField'
import { TaskKindFields } from './TaskKindFields'
import { TaskTypeIcon } from './TaskTypeIcon'

export type AddTaskSheetProps = {
  eventId: string
  forms: readonly TaskFormOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddTaskSheet({ eventId, forms, open, onOpenChange }: AddTaskSheetProps) {
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT)
  const [speakerIds, setSpeakerIds] = useState<readonly string[]>([])
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const close = () => {
    setDraft(EMPTY_TASK_DRAFT)
    setSpeakerIds([])
    onOpenChange(false)
  }

  const submit = () => {
    startTransition(async () => {
      const result = await createTaskAction(toCreateTaskInput(eventId, draft))
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (speakerIds.length > 0 && !(await assign(result.taskId))) return
      toast.success('Saved successfully', { description: 'Your changes have been saved.' })
      close()
    })
  }

  /**
   * The second write. `false` keeps the drawer open, because the task itself was created and
   * an organizer needs to see which half failed rather than a bare error over a closed sheet.
   */
  const assign = async (taskId: string): Promise<boolean> => {
    const result = await assignTasksToSpeakersAction({
      eventId,
      taskIds: [taskId],
      speakerIds,
    })
    if (!result.ok) {
      toast.error(result.message, { description: 'The task was created but not assigned.' })
      return false
    }
    toast.success(
      `Assigned to ${String(result.speakers)} ${result.speakers === 1 ? 'speaker' : 'speakers'}`,
      {
        // Named rather than counted: a Submissions task writes nothing for somebody with no
        // accepted session, and "assigned to 3" with an empty portal is how this capability
        // became untestable in the first place.
        description:
          result.unreachable.length === 0
            ? undefined
            : `No row for ${result.unreachable.join(', ')}: a Submissions task needs an accepted session.`,
      },
    )
    return true
  }

  return (
    // Dismissing the drawer clears the draft as Cancel does, so reopening it does not offer
    // the previous attempt's speakers already ticked against a blank task.
    <Sheet
      open={open}
      onOpenChange={(next: boolean) => {
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>Add Task</SheetTitle>
          <p className="text-sm text-muted-foreground">Create a new task for participants</p>
        </SheetHeader>

        {/* No `min-h-0 flex-1` on this column, and it is load-bearing rather than a style
            tweak: `SheetContent` is the scroller, so a body told to fill the remaining height
            gets a clipped box whose own children then paint OUTSIDE it, and the fields below
            the editor render straight over the footer. Measured on the running app at
            1280x720 in the sibling drawer: the footer sat at y 513-577 while the due date
            field painted at y 719. Letting the column take its natural height puts the footer
            back at the end of the scrolled content. */}
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="task-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.title.length}/{TASK_TITLE_MAX}
              </span>
            </div>
            <Input
              id="task-title"
              value={draft.title}
              maxLength={TASK_TITLE_MAX}
              placeholder="e.g. Upload Presentation Slides"
              onChange={(event) => set('title', event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>
              Type <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={draft.entityType}
              onValueChange={(next) => set('entityType', next as TaskEntityType)}
            >
              {TASK_TYPE_CARDS.map((card) => (
                <Label
                  key={card.entityType}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3',
                    draft.entityType === card.entityType && 'border-primary bg-muted/40',
                  )}
                >
                  <RadioGroupItem value={card.entityType} />
                  <TaskTypeIcon
                    entityType={card.entityType}
                    className="mt-0.5 size-4 text-muted-foreground"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{card.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {card.description}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-instructions">Instructions</Label>
            <Textarea
              id="task-instructions"
              value={draft.description}
              rows={4}
              placeholder="Enter instructions..."
              onChange={(event) => set('description', event.target.value)}
            />
          </div>

          <TaskKindFields
            kind={draft.kind}
            formId={draft.formId}
            forms={forms}
            onKindChange={(next) => set('kind', next)}
            onFormChange={(next) => set('formId', next)}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due">Due date</Label>
            {/* A DATE, not a `datetime-local`, and this was a silent trap rather than a
                preference. `datetime-local` yields the empty string unless both the date
                and the time segments are filled, so an organizer who picked a date and
                left the time alone created a task with no deadline, no validation message
                and nothing on screen to explain it. The field is called Due date and now
                asks for one; the action reads a bare date as the end of that day in the
                event's zone. */}
            {/* `Calendar` inside `Popover`, not a native date input: the native picker
                dismissed the surrounding Sheet and lost the whole form. Same control and
                same reason as the Add File Request drawer, which is where it was found. */}
            <DateKeyField
              id="task-due"
              value={draft.dueAt}
              onChange={(next) => set('dueAt', next)}
              emptyLabel="No due date"
              clearLabel="Clear due date"
            />
            <p className="text-xs text-muted-foreground">
              Due at the end of this day, in the event&apos;s timezone.
            </p>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Applies to all accepted speakers</span>
              <span className="text-xs text-muted-foreground">
                Marks the task for the accept-time fan-out. Assigning is still a separate action, so
                a task can be defined before the decisions are made.
              </span>
            </span>
            <Switch
              checked={draft.appliesToAllAccepted}
              onCheckedChange={(next) => set('appliesToAllAccepted', next)}
            />
          </div>

          {/* Below the switch, and the two are not the same control. The switch marks the
              task for the accept-time fan-out and assigns nobody today; this assigns, now,
              to people an organizer names - including speakers who have nothing accepted and
              whom the fan-out will therefore never reach. */}
          <AssignSpeakersField
            eventId={eventId}
            value={speakerIds}
            onChange={setSpeakerIds}
            entityType={draft.entityType}
            disabled={pending}
          />
        </div>

        <SheetFooter className="flex-row justify-end">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!isTaskDraftValid(draft) || pending} onClick={submit}>
            Create Task
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
