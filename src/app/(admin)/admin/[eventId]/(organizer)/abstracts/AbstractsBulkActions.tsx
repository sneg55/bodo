'use client'

// Bulk actions over the ticked rows: stage into a queue, then Notify.
//
// The two-step mechanic is the point (BUILD_SPEC 5.4). "Bulk actions move rows into
// Accept Queue / Decline Queue; a separate Notify action commits queued rows to
// Accepted/Declined, stamps notifiedAt, writes the EmailOutbox rows." So there is no
// Accept button here. Staging is reversible and silent; Notify is the irreversible half,
// which is why it is the one behind a confirmation.

import { CheckCheckIcon, SendIcon, ThumbsDownIcon } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { notifyQueuedAction, queueDecisionAction } from '@/features/submissions/decisions'
import type { QueueDecision } from '@/features/submissions/transitions'
import { DecisionPreview } from './DecisionPreview'

export type AbstractsBulkActionsProps = {
  eventId: string
  selectedIds: readonly string[]
  onDone: () => void
}

export function AbstractsBulkActions({ eventId, selectedIds, onDone }: AbstractsBulkActionsProps) {
  const [pending, startTransition] = useTransition()

  if (selectedIds.length === 0) return null

  const stage = (decision: QueueDecision) => {
    startTransition(async () => {
      const result = await queueDecisionAction({ eventId, submissionIds: selectedIds, decision })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(summary(result.changed, result.skipped, 'moved'))
      onDone()
    })
  }

  const notify = () => {
    startTransition(async () => {
      const result = await notifyQueuedAction({ eventId, submissionIds: selectedIds })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const queued = `${result.queuedEmails} ${
        result.queuedEmails === 1 ? 'email' : 'emails'
      } queued for sending.`

      // A partial batch must not read as a clean one. Notify guards each row so that one
      // unfixable submission costs only itself, and reporting that as a plain success
      // would make the guard worse than the crash it replaced: before it, a failing row
      // surfaced as an error toast, so swallowing it here would be a regression in the
      // one thing the organizer needs to know.
      if (result.failedCodes.length > 0) {
        toast.warning(
          `${summary(result.changed, result.skipped, 'notified')} ${queued} Not notified: ${result.failedCodes.join(', ')}. Press Notify again to retry just those.`,
        )
        onDone()
        return
      }

      toast.success(`${summary(result.changed, result.skipped, 'notified')} ${queued}`)
      onDone()
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-muted-foreground tabular-nums">
        {selectedIds.length} selected
      </span>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => stage('accept')}>
        <CheckCheckIcon />
        Accept Queue
      </Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => stage('decline')}>
        <ThumbsDownIcon />
        Decline Queue
      </Button>

      <DecisionPreview eventId={eventId} submissionIds={selectedIds} />

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button size="sm" disabled={pending}>
              <SendIcon />
              Notify
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Notify {selectedIds.length} selected?</AlertDialogTitle>
            <AlertDialogDescription>
              Rows in the Accept Queue become Accepted and rows in the Decline Queue become
              Declined. Each one is stamped as notified and its email is queued for sending.
              Anything not in a queue is skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction render={<Button onClick={notify} />}>Notify</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** "12 moved, 3 skipped." Skips are reported rather than hidden: see decisions.ts. */
function summary(changed: number, skipped: number, verb: string): string {
  const done = `${changed} ${verb}`
  return skipped > 0 ? `${done}, ${skipped} skipped.` : `${done}.`
}
