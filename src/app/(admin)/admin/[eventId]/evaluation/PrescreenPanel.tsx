'use client'

// The AI pre-screen control on the active round (BUILD_SPEC 5.4).
//
// Pressing the button ENQUEUES and returns; the cron tick scores. So the button's job is
// to say that, and the progress line is what actually tells the organizer where a round
// has got to. The line reads job counts rather than review counts, because a job that
// failed three times has no review to count and would otherwise be an invisible gap
// between "31 of 32" and a bar that never fills.
//
// Everything here is labelled: an AI score that reads like a committee score is the one
// failure this feature can cause that nobody notices, so the panel says what wrote the
// reviews, and says again when the scores are a keyless sample.
//
// The sentences all come from prescreen-copy.ts rather than being chosen in the branches
// below, because this component cannot be rendered in a test: a badge that miscounts what
// happened to a job is exactly the kind of thing only a test catches.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress, ProgressIndicator, ProgressTrack, ProgressValue } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  prescreenPressOutcome,
  prescreenProgressLabel,
  prescreenStoppedNotice,
  prescreenUnavailableReason,
  prescreenWaitState,
} from '@/features/jobs/prescreen-copy'
import { PRESCREEN_MAX_ATTEMPTS, type PrescreenFailure } from '@/features/jobs/prescreen-queue'
import type { PrescreenView } from '@/features/review/evaluation-view'
import { startPrescreenAction } from '@/features/review/prescreen-actions'

import { ProgressPoller } from '../(organizer)/tasks/ProgressPoller'

export type PrescreenPanelProps = {
  eventId: string
  roundId: string
  roundName: string
  prescreen: PrescreenView
}

export function PrescreenPanel({ eventId, roundId, roundName, prescreen }: PrescreenPanelProps) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // The wait a lost round leaves behind. `refresh: false` presses never set it, because
  // whatever they wrote is already in the render the action returned.
  const [waiting, setWaiting] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const { counts } = prescreen
  const settled = counts.done + counts.blocked
  const percent = counts.total === 0 ? 0 : Math.round((settled / counts.total) * 100)
  const progress = prescreenProgressLabel(counts)
  // The sentence a round that stopped needs, and the one it did not have: it says the press
  // is the retry. `prescreenTargets` is the half that makes that true.
  const stopped = prescreenStoppedNotice(counts)
  // Takes the whole view, so `queueUnreadable` reaches the reason without another prop.
  const unavailable = prescreenUnavailableReason(prescreen)
  // One attempt per server payload, which is how the panel counts polls without owning a
  // timer of its own: `prescreen` is a fresh object on every render the poller's
  // `router.refresh()` produces, so this compare is true exactly once per poll. Adjusted
  // during render rather than in an effect, because that is what React asks for when state
  // derives from a prop changing, and what the lint rule here enforces.
  const [seen, setSeen] = useState(prescreen)
  if (seen !== prescreen) {
    setSeen(prescreen)
    if (waiting) setAttempts((spent) => spent + 1)
  }

  // Every branch of "is this panel still waiting, and what does it say" is decided in
  // prescreen-copy.ts, for the reason the header gives: nothing here can be rendered in a
  // test, so a wait that never ends would be a bug no test could catch. Nothing clears
  // `waiting` again, because it stops mattering the moment the round has rows.
  const wait = prescreenWaitState({ counts, waiting, attempts })

  const start = () => {
    startTransition(async () => {
      const outcome = prescreenPressOutcome({
        roundName,
        result: await startPrescreenAction({ eventId, roundId }),
      })
      if (outcome.tone === 'error') toast.error(outcome.message)
      else if (outcome.tone === 'info') toast.info(outcome.message)
      else toast.success(outcome.message)
      // Only the press that LOST the round asks for this, and prescreen-copy.ts says why:
      // it wrote nothing, so nothing invalidated, so nothing re-rendered, and on an empty
      // round there is not even a poller mounted to pick the winner's rows up later. The
      // single refresh is not enough on its own: it can land while the winner is still
      // reading, so the wait below keeps the poller mounted until rows actually appear.
      if (outcome.refresh) {
        setAttempts(0)
        setWaiting(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filled only while it can actually be pressed. A round with nothing to score
            still shows the control, because the sentence under it explains why, but painted
            as the primary it was the loudest thing on the page and the only one that did
            nothing: the enabled `Remind everyone behind` beside it is a plain outline.
            `pending` is not part of the test, so a press does not change the button's
            weight underneath the finger. */}
        <Button
          variant={unavailable === undefined ? 'default' : 'outline'}
          disabled={pending || unavailable !== undefined}
          onClick={start}
        >
          AI pre-screen
        </Button>
        {/* The sentence comes from the server rather than from `@/services/ai`, which
            reaches the Anthropic SDK: importing it here would ship the SDK to the browser
            to render one line of text. */}
        {prescreen.sampleNotice === undefined ? null : (
          <Badge variant="outline">{prescreen.sampleNotice}</Badge>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {unavailable ??
          `Scores every submission in ${roundName} that has a reviewer and no AI review yet, against this round's criteria. AI reviews are labelled and stay out of the human average.`}
      </p>

      {/* The counts above come from the server render, and cron is what moves them: each
          job's write expires `event:{id}:prescreen`, so the NEXT request is fresh and
          nothing here starts one. Same poller as the tasks dashboard, and mounted OUTSIDE
          the progress block so the round that has no rows yet can still be waiting for
          them. It stops as soon as the queue has drained, or as soon as the wait for a
          contended round has run out, rather than refreshing forever either way. */}
      <ProgressPoller enabled={wait.polling} />

      {/* Only ever set while the panel is holding an empty round open. Says which of the
          two it is: still waiting, or given up and pressable again. */}
      {wait.notice === undefined ? null : (
        <p className="text-sm text-muted-foreground">{wait.notice}</p>
      )}

      {counts.total === 0 ? null : (
        <>
          <Separator />
          {/* `aria-label` because the primitive announces a bare percentage, and the
              sighted label is the count. Same fix as the tasks dashboard. Both come from
              `prescreenProgressLabel`, so a full bar and its sentence cannot disagree about
              how many submissions were actually scored. */}
          <Progress value={percent} aria-label={`${roundName}: ${progress}`}>
            <ProgressValue>{() => progress}</ProgressValue>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{counts.done} scored</Badge>
            {counts.running + counts.queued > 0 ? (
              <Badge variant="outline">{counts.running + counts.queued} waiting</Badge>
            ) : null}
            {/* Failures are visible rather than folded into "waiting", and the two kinds
                are separated: one retries itself on the next tick, the other never will. */}
            {counts.failed > 0 ? <Badge variant="outline">{counts.failed} retrying</Badge> : null}
            {/* "Stopped", not "gave up", because this bucket is no longer only the jobs
                that failed three times: a job whose Worker was cancelled after stamping the
                last attempt never reported anything, and the queue stops on it just the
                same. What is true of all of them is that the attempts ran out. */}
            {counts.blocked > 0 ? (
              <Badge variant="destructive">
                {counts.blocked} stopped after {PRESCREEN_MAX_ATTEMPTS} attempts
              </Badge>
            ) : null}
          </div>

          <StoppedNotice notice={stopped} failures={prescreen.failures} />
        </>
      )}
    </div>
  )
}

/**
 * What stopped, and that pressing the button again is the way out of it.
 *
 * Both halves were missing at once, which is what made the round unrecoverable: it reported
 * itself covered with nothing scored, offered no reason, and re-queued nothing on the next
 * press. `prescreenTargets` fixed the last of those; this says the other two.
 */
function StoppedNotice({
  notice,
  failures,
}: {
  notice?: string
  failures: readonly PrescreenFailure[]
}) {
  if (notice === undefined) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm">{notice}</p>
      {/* The drain's own message, verbatim: an error id and a status line is what makes a
          recurrence diagnosable, and paraphrasing it here would lose exactly that.
          `break-words` because a model API's error carries a URL. */}
      {failures.map((failure) => (
        <p key={failure.error} className="text-xs break-words text-muted-foreground">
          {failure.count > 1 ? `${failure.count} x ` : null}
          {failure.error}
        </p>
      ))}
    </div>
  )
}
