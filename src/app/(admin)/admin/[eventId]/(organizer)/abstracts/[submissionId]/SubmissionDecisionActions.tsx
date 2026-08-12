'use client'

// The decision controls on one submission, so opening a record is not a dead end.
//
// The detail page used to render exactly two controls, the Content select and Edit, which
// meant every accept and decline had to be made from the list's bulk bar: drilling into a
// submission to read the abstract, the answers and the reviews moved the organizer away
// from the only place they could act on what they had just read.
//
// It calls the SAME actions the bulk bar calls, with a one-element selection, rather than
// a second decision path. `queueDecisionAction` and `notifyQueuedAction` already hold the
// two-step mechanic BUILD_SPEC 5.4 requires (staging is reversible and silent, Notify is
// the irreversible half that commits, stamps `notifiedAt` and writes the outbox rows), and
// a detail page with its own copy of that would be a second place for it to drift. Each
// one begins with `requireEventRole(eventId, 'admin')` in the action itself, so rendering
// this only for an admin is presentation, not the access check.
//
// Nothing here calls `router.refresh()`. Every action goes through `invalidate()`, which
// expires the tags the read cached under and re-renders this route as part of the action's
// own response.
//
// The track-fix banner is the one control here that is not a decision: it exists for a
// submission that was already accepted before `commitStatus` started reconciling tracks on
// accept (`commit-status.ts`, `track-repair.ts`), so nothing else will ever offer to fix
// it. The page only passes `trackFix` down when `previewTrackFix` found a real, resolvable
// disagreement, so this never has to guess whether a mismatch is genuine.

import { AlertTriangleIcon, CheckCheckIcon, SendIcon, ThumbsDownIcon } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { StatusChipEditor, submissionStatusLabel } from '@/components/primitives/StatusChip'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import type { SubmissionStatus } from '@/constants/status'
import {
  notifyQueuedAction,
  queueDecisionAction,
  setStatusAction,
} from '@/features/submissions/decisions'
import { repairSubmissionTrackAction } from '@/features/submissions/track-repair-action'
import type { QueueDecision } from '@/features/submissions/transitions'
import { DecisionPreview } from '../DecisionPreview'

const QUEUE_LABEL: ReadonlyMap<QueueDecision, string> = new Map([
  ['accept', 'Accept Queue'],
  ['decline', 'Decline Queue'],
])

export function SubmissionDecisionActions({
  eventId,
  submissionId,
  status,
  notified,
  trackFix,
}: {
  eventId: string
  submissionId: string
  status: SubmissionStatus
  /**
   * Whether this row has already been notified. Only the refusal copy reads it: `notifyTarget`
   * skips an already-notified row and a not-yet-decided one alike, and saying so with one
   * sentence sent an organizer to the wrong place. See the toast below.
   */
  notified: boolean
  /** Present only when the submission's own answers name a track the record disagrees
   *  with. Undefined for everything else: a pending or staged row, one with no form, and
   *  one already carrying the track it was submitted with. */
  trackFix?: { trackId: string; trackName?: string }
}) {
  const [pending, startTransition] = useTransition()
  const selection = [submissionId]

  const changeStatus = (next: SubmissionStatus | null) => {
    // `null` is the popover's Clear control. A submission always has a place in the
    // lifecycle, so clearing is no change rather than a write of an empty status.
    if (next === null) return
    startTransition(async () => {
      const result = await setStatusAction({ eventId, submissionId, status: next })
      if (!result.ok) {
        // The lifecycle refusal lands here: "pending cannot become accepted: promote
        // through the accept or decline queue so Notify can send the email".
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully')
    })
  }

  const stage = (decision: QueueDecision) => {
    const label = QUEUE_LABEL.get(decision) ?? 'queue'
    startTransition(async () => {
      const result = await queueDecisionAction({ eventId, submissionIds: selection, decision })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // The bulk bar reports a count because it acted on a selection. One row has no count
      // worth reading, and the case that matters is the one the count used to hide: a row
      // the lifecycle would not move is skipped rather than refused, so a plain success
      // toast would claim a move that did not happen.
      if (result.changed === 0) {
        toast.warning(`${submissionStatusLabel(status)} cannot move to the ${label}.`)
        return
      }
      toast.success(`Moved to ${label}.`)
    })
  }

  const notify = () => {
    startTransition(async () => {
      const result = await notifyQueuedAction({ eventId, submissionIds: selection })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Notify guards each row, so a failure comes back as a successful result naming the
      // code it could not commit. Reporting that as a clean send is the one thing the
      // organizer cannot recover from, because the mail is what they would go looking for.
      if (result.failedCodes.length > 0) {
        toast.warning(
          `Not notified: ${result.failedCodes.join(', ')}. Press Notify again to retry.`,
        )
        return
      }
      if (result.changed === 0) {
        // Two different reasons, and they need two different sentences. The single "in
        // neither queue" line was filed by the 2026-08-12 eval run as right behaviour with
        // the wrong stated reason: an ALREADY-NOTIFIED row is skipped on purpose, and telling
        // its organizer to put it in a queue sends them to stage a decision that is already
        // made and already sent.
        toast.warning(
          notified
            ? 'Already notified: its email was sent when the decision was committed.'
            : 'Nothing to notify: move it to the Accept or Decline Queue first.',
        )
        return
      }
      toast.success(
        `Notified. ${result.queuedEmails} ${
          result.queuedEmails === 1 ? 'email' : 'emails'
        } queued for sending.`,
      )
    })
  }

  const applyTrackFix = () => {
    if (trackFix === undefined) return
    startTransition(async () => {
      const result = await repairSubmissionTrackAction({ eventId, submissionId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // A `false` here means the record changed between the page load and the click (a
      // second tab, or the button pressed twice) rather than a failure: there is nothing
      // left to apply, which is itself the goal.
      toast.success(
        result.corrected
          ? `Assigned track updated to ${trackFix.trackName ?? 'the submitted track'}.`
          : 'Already up to date.',
      )
    })
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {trackFix === undefined ? null : (
        <Alert className="w-full text-left">
          <AlertTriangleIcon />
          <AlertTitle>Assigned track does not match the submitted answer</AlertTitle>
          <AlertDescription>
            The speaker answered{' '}
            <span className="font-medium text-foreground">
              {trackFix.trackName ?? 'a different track'}
            </span>{' '}
            on the form. Applying this sets the Assigned track above to match it.
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" disabled={pending} onClick={applyTrackFix}>
              Use {trackFix.trackName ?? 'submitted track'}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <StatusChipEditor status={status} disabled={pending} onChange={changeStatus} />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => stage('accept')}>
          <CheckCheckIcon />
          Accept Queue
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => stage('decline')}>
          <ThumbsDownIcon />
          Decline Queue
        </Button>

        <DecisionPreview eventId={eventId} submissionIds={selection} />

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
              <AlertDialogTitle>Notify this submission?</AlertDialogTitle>
              <AlertDialogDescription>
                A row in the Accept Queue becomes Accepted and a row in the Decline Queue becomes
                Declined. It is stamped as notified and its email is queued for sending. A row
                already decided but never notified is sent too. Anything already notified is
                skipped.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
              <AlertDialogAction render={<Button onClick={notify} />}>Notify</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
