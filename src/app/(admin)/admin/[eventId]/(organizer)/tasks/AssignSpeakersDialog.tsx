'use client'

// "Assign to specific speakers" from the BOARD, for tasks that already exist. SPK-09.
//
// The last entry point into the named-speaker path. `AssignSpeakersField` put it on the Add
// Task drawer, so a task could be given to a named person AT CREATION; the board's own kebab
// and bulk button still went only to the accepted cohort, which meant reaching a keynote
// invited over email, a prospect, or anybody imported from a spreadsheet with a task that
// already existed meant deleting it and making it again through Add Task.
//
// It reuses the picker rather than growing a second selection surface, so there is one
// searchable roster control with one set of per-row accepted counts. It sits BESIDE the
// accepted-cohort button rather than replacing it: a three-task checklist to the accepted
// cast in one press is the right shortcut and R6 asks for it.
//
// WHAT THIS FILE IS REALLY FOR is the silent drop. A Submissions-scoped task assigned to
// somebody with no accepted session writes nothing, because `planFanout` refuses a row with
// an empty submission link. An entry point that reported "Assigned 3 tasks across 2 speakers"
// over an empty portal is how SPK-09 became unjudgeable, so this surfaces the same fact
// twice, from two independent sources:
//
//   1. BEFORE, from the cards and the picker. `assignSelectionSummary` says how much of the
//      selection is conditional, and the picker's own line names how many chosen speakers
//      have no accepted session.
//   2. AFTER, from the action. `unreachable` is computed by RUNNING the planner per scope, so
//      it is what actually happened rather than a prediction, and it is reported as a warning
//      naming the people rather than folded into a count.
//
// Copy is authored: docs/parity/portal-tasks-forms.md lists this drawer under Ambiguities.

import { UserPlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { assignTasksToSpeakersAction } from '@/features/tasks/actions'
import {
  assignSelection,
  assignSelectionSummary,
  entityTypeForWarning,
} from '@/features/tasks/assign-selection'
import type { TaskCardView } from '@/features/tasks/cards'

import { AssignSpeakersField } from './AssignSpeakersField'

export function AssignSpeakersDialog({
  eventId,
  cards,
  taskIds,
  disabled = false,
  onAssigned,
}: {
  eventId: string
  /** Every card the board is holding, so the ticked ids can be resolved to their types. */
  cards: readonly TaskCardView[]
  taskIds: readonly string[]
  disabled?: boolean
  onAssigned: () => void
}) {
  const [open, setOpen] = useState(false)
  const [speakerIds, setSpeakerIds] = useState<readonly string[]>([])
  const [pending, startTransition] = useTransition()

  const selection = assignSelection(cards, taskIds)

  const assign = () => {
    startTransition(async () => {
      const result = await assignTasksToSpeakersAction({ eventId, taskIds, speakerIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      setOpen(false)
      setSpeakerIds([])
      onAssigned()
      report(result)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Cleared on close, so reopening after one assignment does not offer the previous
        // people as though they were still chosen for the next batch.
        if (!next) setSpeakerIds([])
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" disabled={disabled || taskIds.length === 0}>
            <UserPlusIcon />
            Assign to specific speakers
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to specific speakers</DialogTitle>
          <DialogDescription>{assignSelectionSummary(selection)}</DialogDescription>
        </DialogHeader>

        <AssignSpeakersField
          eventId={eventId}
          value={speakerIds}
          onChange={setSpeakerIds}
          // `submission` when ANY ticked task is submission-scoped, so a mixed selection still
          // warns about the one that would silently write nothing. See `entityTypeForWarning`.
          entityType={entityTypeForWarning(selection)}
          disabled={pending}
        />

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={assign} disabled={pending || speakerIds.length === 0}>
            {pending ? 'Assigning...' : `Assign to ${String(speakerIds.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Say what actually happened, and never a cheerful success over an empty write.
 *
 * Three outcomes, and collapsing them is the defect this whole surface exists to avoid.
 * Nothing created with somebody unreachable is a FAILURE to report, not a success with a
 * footnote; nothing created with everything already in place is the ordinary idempotent
 * re-press; and a partial write has to name the people it missed alongside the count of the
 * ones it did not.
 */
function report(result: {
  created: number
  skipped: number
  speakers: number
  unreachable: readonly string[]
}): void {
  const missed = result.unreachable.join(', ')

  if (result.created === 0 && result.unreachable.length > 0) {
    toast.warning('Nothing was assigned', {
      description: `${missed} ${result.unreachable.length === 1 ? 'has' : 'have'} no accepted session, so a Submissions task writes no row. Use a Contacts task to reach them.`,
    })
    return
  }
  if (result.created === 0) {
    toast.success('Already assigned', {
      description: `${String(result.skipped)} ${result.skipped === 1 ? 'row was' : 'rows were'} already in place.`,
    })
    return
  }

  toast.success(
    `Assigned ${String(result.created)} ${result.created === 1 ? 'task' : 'tasks'} across ${String(result.speakers)} ${result.speakers === 1 ? 'speaker' : 'speakers'}`,
    {
      description:
        result.skipped === 0
          ? undefined
          : `${String(result.skipped)} already had a row and were left alone.`,
    },
  )
  if (result.unreachable.length > 0) {
    // A SEPARATE toast rather than a line under the success, because it is a different
    // outcome for different people: some of the chosen got nothing at all.
    toast.warning(`Not reached: ${missed}`, {
      description: 'No accepted session, so the Submissions task in this selection wrote no row.',
    })
  }
}
