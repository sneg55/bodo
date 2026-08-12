'use client'

// `Disconnect`, inside the row's overflow menu, behind a confirmation.
//
// An `AlertDialog` and not a plain menu item, because this is the destructive half of the
// pair: it stops accepted sessions reaching the registration platform, and an organizer who
// clicks it by accident finds out at the next accept rather than now. The component map puts
// destructive confirmation on `AlertDialog` for exactly this.
//
// The item is rendered even when nothing is connected, disabled, rather than hidden. A menu
// whose contents change shape between visits is a menu people stop trusting, and the vendor's
// own affordance has `Disconnect` in this position permanently.
//
// What it does NOT do is delete `IntegrationMappings` or `SyncLog`. Those rows record what
// bodo has already written into the far side, and dropping them would not un-write it: the
// remote records still exist, and the mapping is the only thing that lets a later reconnect
// UPDATE them instead of creating a second copy of every session. The dialog says so, because
// "disconnect" reads like "undo" and here it is not.

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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { disconnectAcceleventsAction } from '@/features/integrations/actions'

export type DisconnectItemProps = {
  eventId: string
  label: string
  connected: boolean
}

export function DisconnectItem({ eventId, label, connected }: DisconnectItemProps) {
  const [pending, startTransition] = useTransition()

  function confirmDisconnect(): void {
    startTransition(async () => {
      const result = await disconnectAcceleventsAction({ eventId })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`${label} disconnected`)
    })
  }

  if (!connected) return <DropdownMenuItem disabled>Disconnect</DropdownMenuItem>

  return (
    <AlertDialog>
      {/* `closeOnClick={false}`: the menu closing would unmount the dialog it just opened. */}
      <AlertDialogTrigger render={<DropdownMenuItem closeOnClick={false} variant="destructive" />}>
        Disconnect
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This event stops syncing to {label}. Sessions already pushed there are not removed, and
            the record of what was pushed is kept, so reconnecting later updates those sessions
            rather than creating a second copy of each one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDisconnect} disabled={pending}>
            {pending ? 'Disconnecting...' : 'Disconnect'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
