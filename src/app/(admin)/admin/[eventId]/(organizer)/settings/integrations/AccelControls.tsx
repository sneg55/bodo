'use client'

// Section 4: Controls. `Sync now` and `Retry failed`.
//
// TWO DIALOGS, never one. They are not variants of each other: `Sync now` walks the whole
// event and can CREATE records on somebody else's registration platform, while
// `Retry failed` replays payload snapshots that have already been refused once. A shared
// confirmation would have to describe both, which means describing neither, and the point
// of a confirmation is that the sentence in it is true of the thing about to happen.
//
// Both are disabled while in flight, through `useTransition`. Two overlapping syncs are not
// a correctness problem (`claimOnce` fences each entity through the ClaimGuard Durable
// Object, and the second caller is counted as contended), but they are a spent Airtable
// budget and a confusing pair of toasts.
//
// Both are also disabled for a reviewer, and that is a rendering decision only: the actions
// call `requireIntegrationsAdmin` for themselves, because an action is reachable by POST
// without this component ever mounting.
//
// `router.refresh()` after a run re-renders the page from the server. It invalidates no
// server cache entry on its own, which is exactly why the actions expire
// `event:{id}:integrations` before returning: the refresh then reads the tables back
// through a cache that has already been told it is stale.

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState, useTransition } from 'react'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { retryFailedSyncsAction, syncEventNowAction } from '@/features/integrations/actions'
import type { SyncSummary } from '@/features/integrations/run-summary'
import type { ActionResult } from '@/features/review/action-result'

export type AccelControlsProps = {
  eventId: string
  /** False when the key is missing: a control that 500s is worse than one that explains. */
  configured: boolean
  /** False for a reviewer. Reading this page is allowed; pressing these is not. */
  canRun: boolean
}

export function AccelControls({ eventId, configured, canRun }: AccelControlsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<'sync' | 'retry' | undefined>(undefined)

  const run = (work: () => Promise<ActionResult<SyncSummary>>) => {
    setConfirming(undefined)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // `needsAttention` rather than `ok`, because a run that finished and refused three
      // sessions is not a success to celebrate: the counts are in the message either way,
      // but a green toast over three failures is how a failed sync goes unnoticed.
      if (result.needsAttention) toast.warning(result.message)
      else toast.success(result.message)
      router.refresh()
    })
  }

  const blocked = pending || !configured || !canRun

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={blocked} onClick={() => setConfirming('sync')}>
          Sync now
        </Button>
        <Button variant="outline" disabled={blocked} onClick={() => setConfirming('retry')}>
          Retry failed
        </Button>
      </div>

      {canRun ? null : (
        <p className="text-sm text-muted-foreground">
          You can read this page as a reviewer. Running a sync needs the admin role on this event.
        </p>
      )}

      <Confirm
        open={confirming === 'sync'}
        pending={pending}
        onOpenChange={(open) => setConfirming(open ? 'sync' : undefined)}
        title="Sync this event to Accelevents?"
        confirmLabel="Sync now"
        onConfirm={() => run(async () => await syncEventNowAction({ eventId }))}
      >
        This walks the whole event in dependency order: tracks and tags, then the speakers cast in
        accepted sessions, then the sessions themselves. Records that do not exist on the far side
        are CREATED there. Anything whose payload has not changed since it was last accepted is
        skipped rather than sent again.
      </Confirm>

      <Confirm
        open={confirming === 'retry'}
        pending={pending}
        onOpenChange={(open) => setConfirming(open ? 'retry' : undefined)}
        title="Retry this event's failed attempts?"
        confirmLabel="Retry failed"
        onConfirm={() => run(async () => await retryFailedSyncsAction({ eventId }))}
      >
        This replays the stored payload of each failed row above, not the record as it stands now,
        so a session edited since the failure is sent as it was when it failed. Only this
        event&apos;s rows are touched. Rows whose payload has since been accepted are skipped.
      </Confirm>
    </div>
  )
}

/**
 * The shell both dialogs share, and only the shell.
 *
 * The title, the body and the confirm label all come from the caller, so the two controls
 * cannot end up describing each other. Controlled rather than trigger-driven, so the button
 * that opens it stays an ordinary disabled-able `Button`.
 */
function Confirm({
  open,
  pending,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  children,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  title: string
  confirmLabel: string
  onConfirm: () => void
  children: ReactNode
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
          <AlertDialogAction render={<Button disabled={pending} onClick={onConfirm} />}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
