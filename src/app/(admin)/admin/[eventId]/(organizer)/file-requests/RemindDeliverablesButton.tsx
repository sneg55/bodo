'use client'

// The Delivery status header's bulk nudge: email everyone who still owes a document. CNT-08.
//
// The same shape as `../tasks/RemindOutstandingButton`, deliberately and down to the copy
// pattern, because it is the same verb on the other table and an organizer should not have to
// read two different confirmations to do one thing. It CONFIRMS first for the reason that one
// gives: the number of people it is about to mail exists nowhere on screen until the dialog
// names it, and mail cannot be recalled.
//
// It sends to whoever is BEHIND, recomputed on the server, rather than to a ticked selection.
// `speakerIds` is carried anyway because the action treats it as a filter, so the per-speaker
// drill-down next to it has somewhere to go.
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
import { remindOutstandingFilesAction } from '@/features/comms/file-reminder-actions'

export function RemindDeliverablesButton({
  eventId,
  speakerIds,
  files,
  disabled = false,
}: {
  eventId: string
  /** Everyone the table currently shows as owing a document. Empty disables the control. */
  speakerIds: readonly string[]
  /** How many documents those people owe between them, so the dialog can say what goes out. */
  files: number
  /** False for a reviewer, who may read this board and may not mail the roster. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const count = speakerIds.length

  const send = () => {
    startTransition(async () => {
      const result = await remindOutstandingFilesAction({ eventId, speakerIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      setOpen(false)
      // Zero queued is the ordinary "you already chased these people today" and must not read
      // as a send. The file count is in the description because it is what makes the
      // confirmation specific: the reminder names each person's own outstanding documents.
      if (result.queued === 0) {
        toast.success('Everyone behind has already been reminded today')
      } else {
        toast.success(
          result.queued === 1 ? 'Reminder queued' : `${String(result.queued)} reminders queued`,
          {
            description: `Naming ${String(result.files)} outstanding ${result.files === 1 ? 'file' : 'files'} and their due dates.`,
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
            Remind speakers with outstanding files
            {count === 0 ? null : ` (${String(count)})`}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remind speakers with outstanding files</DialogTitle>
          <DialogDescription>
            {count === 1
              ? 'One speaker will be emailed the documents they still owe, with each due date.'
              : `${String(count)} speakers will be emailed the documents they still owe, with each due date.`}{' '}
            {files === 0
              ? null
              : `${String(files)} outstanding ${files === 1 ? 'document' : 'documents'} between them. `}
            Anyone who has uploaded everything since this page loaded is left alone.
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
