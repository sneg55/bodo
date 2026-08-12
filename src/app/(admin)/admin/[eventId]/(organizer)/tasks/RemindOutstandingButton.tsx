'use client'

// The Onboarding status header's bulk nudge: email everyone who still owes deliverables.
// CNT-08.
//
// It CONFIRMS first, and here that is worth the extra click in a way it is not in the
// composer next door. This is a single button on a table an organizer is already scanning, so
// the number of people it is about to mail exists nowhere on screen until the dialog names it,
// and mail cannot be recalled. `InviteSpeakersButton` guards the same shape for the same
// reason.
//
// It sends to whoever is BEHIND, recomputed on the server, rather than to a selection. The
// table already has a `Has outstanding` filter that says who those people are, and a second
// per-row checkbox column would be a second way to express the same set. `speakerIds` is
// carried anyway because the action treats it as a filter, so a future per-row control has
// somewhere to go.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED: no screenshot of this surface exists, so this
// copy has no parity checklist behind it.

import { BellRingIcon } from 'lucide-react'
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
import { remindOutstandingTasksAction } from '@/features/comms/task-reminder-actions'

export function RemindOutstandingButton({
  eventId,
  speakerIds,
  disabled = false,
}: {
  eventId: string
  /** Everyone the table currently shows as behind. Empty disables the control. */
  speakerIds: readonly string[]
  /** False for a reviewer, who may read this board and may not mail the roster. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const count = speakerIds.length

  const send = () => {
    startTransition(async () => {
      const result = await remindOutstandingTasksAction({ eventId, speakerIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      setOpen(false)
      // Zero queued is the ordinary "you already chased these people today" and must not read
      // as a send. The task count is in the description because it is what makes the
      // confirmation specific: the reminder names each person's own outstanding to-dos.
      if (result.queued === 0) {
        toast.success('Everyone behind has already been reminded today')
      } else {
        toast.success(
          result.queued === 1 ? 'Reminder queued' : `${String(result.queued)} reminders queued`,
          {
            description: `Naming ${String(result.tasks)} outstanding ${result.tasks === 1 ? 'task' : 'tasks'} and their due dates.`,
          },
        )
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={disabled || count === 0}>
            <BellRingIcon />
            Remind speakers with outstanding tasks
            {count === 0 ? null : ` (${String(count)})`}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remind speakers with outstanding tasks</DialogTitle>
          <DialogDescription>
            {count === 1
              ? 'One speaker will be emailed the tasks they still owe, with each due date.'
              : `${String(count)} speakers will be emailed the tasks they still owe, with each due date.`}{' '}
            Anyone who has finished everything since this page loaded is left alone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={send} disabled={pending}>
            {pending ? 'Sending...' : 'Send reminders'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
