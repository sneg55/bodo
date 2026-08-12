'use client'

// The portal list's client half: the order an organizer is dragging, the three row actions,
// and the destructive confirmation.
//
// @dnd-kit is behind `next/dynamic` here rather than imported at the top, per
// `.claude/rules/bodo-conventions.md`. `ssr: false` because the sortable rows own a drag
// state that only exists in the browser, and server-rendering them produces markup the
// client replaces on hydration.
//
// The dragged order is held locally so a drop lands immediately instead of after the
// server round trip, and it is re-seeded whenever the server hands down a new list: that is
// the "adjusting state when props change" pattern rather than an effect, so a refresh never
// renders one frame of the stale order. A refused reorder puts the previous order back,
// because a list that keeps showing an order the server rejected is a list that lies about
// which portal claims a contact first.

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  deletePortalAction,
  duplicatePortalAction,
  reorderPortalsAction,
} from '@/features/portal-config/actions'
import { settled } from '@/features/portal-config/settled'

import type { PortalRowView } from './PortalRow'

const PortalRows = dynamic(() => import('./PortalRow').then((module) => module.PortalRows), {
  ssr: false,
  loading: () => <Skeleton className="h-40 w-full rounded-xl" />,
})

export function PortalList({ eventId, rows }: { eventId: string; rows: readonly PortalRowView[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [order, setOrder] = useState(rows)
  const [seen, setSeen] = useState(rows)
  const [confirming, setConfirming] = useState<PortalRowView | undefined>(undefined)

  if (seen !== rows) {
    setSeen(rows)
    setOrder(rows)
  }

  function reorder(activeId: string, overId: string): void {
    const custom = order.filter((row) => !row.isDefault)
    const from = custom.findIndex((row) => row.id === activeId)
    const to = custom.findIndex((row) => row.id === overId)
    if (from === -1 || to === -1 || from === to) return

    const moved = [...custom]
    moved.splice(to, 0, ...moved.splice(from, 1))
    // The default first, always. The action writes it at 0 regardless, so sending it in
    // any other position would only make the two disagree about what was asked for.
    const next = [...order.filter((row) => row.isDefault), ...moved]
    const previous = order
    setOrder(next)

    startTransition(async () => {
      const result = await settled(
        reorderPortalsAction({ eventId, portalIds: next.map((row) => row.id) }),
      )
      if (result.ok) {
        router.refresh()
      } else {
        setOrder(previous)
        toast.error(result.error)
      }
    })
  }

  function duplicate(row: PortalRowView): void {
    startTransition(async () => {
      // This is the call that showed what an unsettled rejection costs on a list screen: a
      // 500 from the action module took the whole admin shell to "This page couldn't load",
      // because nothing here caught it. Now it is a toast over a list that stays put.
      const result = await settled(duplicatePortalAction({ eventId, portalId: row.id }))
      if (result.ok) {
        toast.success('Saved successfully', { description: `${row.name} was duplicated.` })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  function remove(row: PortalRowView): void {
    startTransition(async () => {
      const result = await settled(deletePortalAction({ eventId, portalId: row.id }))
      setConfirming(undefined)
      if (result.ok) {
        toast.success('Saved successfully', { description: `${row.name} was deleted.` })
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <>
      <PortalRows
        eventId={eventId}
        rows={order}
        disabled={pending}
        onReorder={reorder}
        onDelete={setConfirming}
        onDuplicate={duplicate}
      />

      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(next: boolean) => {
          if (!next) setConfirming(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirming?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Its ${String(confirming?.matchedCount ?? 0)} contacts fall through to the next portal they match, or to the default portal. Nothing they were assigned is deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={pending} />}
              onClick={() => {
                if (confirming !== undefined) remove(confirming)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
