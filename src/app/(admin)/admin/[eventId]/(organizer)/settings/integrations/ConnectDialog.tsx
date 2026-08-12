'use client'

// `Connect` for Accelevents: the form that maps this event to a remote one.
//
// This exists because the control it replaces was disabled. `Events.accelEventUrl` and
// `accelEventId` were readable everywhere and writable only in Airtable itself, so the
// button sat there explaining that connecting happened somewhere else, which is a fair
// description of a gap and a bad answer to "connect this". BUILD_SPEC 5.0d calls the
// event-to-event mapping the Connection card's job, and this is that card's write.
//
// A `Dialog` and not a `Sheet`: two fields and one decision. The component map puts a
// right-hand drawer behind things with a page's worth of surface (Preferences, Add Abstract)
// and a centred modal behind a focused decision, which this is.
//
// It is deliberately NOT a `<form action={...}>`. The action returns a Result rather than
// throwing (`action-result.ts` says why), so the dialog has to read that value to decide
// between closing and showing a message, and a plain form submit gives it nowhere to do so.

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { connectAcceleventsAction } from '@/features/integrations/actions'

export type ConnectDialogProps = {
  eventId: string
  label: string
  /** The slug already stored, so reopening the dialog edits rather than starts over. */
  currentEventUrl?: string
  currentRemoteEventId?: string
  /**
   * What the provider is still missing beyond this mapping, e.g. the API key.
   *
   * Shown and NOT treated as a reason to disable the form. The key is deployment
   * configuration that no organizer can set from a browser, and refusing the mapping until
   * somebody else edits an environment variable would block the half of the job they can
   * actually do. Saving the mapping while the key is absent is a legitimate state: the
   * Connection card already reports it, and `Sync now` refuses for itself.
   */
  missing?: readonly string[]
}

export function ConnectDialog({
  eventId,
  label,
  currentEventUrl,
  currentRemoteEventId,
  missing = [],
}: ConnectDialogProps) {
  const [open, setOpen] = useState(false)
  const [eventUrl, setEventUrl] = useState(currentEventUrl ?? '')
  const [remoteEventId, setRemoteEventId] = useState(currentRemoteEventId ?? '')
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  const connected = (currentEventUrl ?? '') !== ''

  function submit(): void {
    setError(undefined)
    startTransition(async () => {
      const result = await connectAcceleventsAction({ eventId, eventUrl, remoteEventId })
      if (!result.ok) {
        setError(result.message)
        return
      }
      // The stored slug, not what was typed: a pasted address is normalized on the way in,
      // so echoing the input back would tell the organizer something that is not in the row.
      toast.success(`${label} connected to ${result.eventUrl}`)
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {connected ? 'Edit connection' : 'Connect'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {label}</DialogTitle>
          <DialogDescription>
            Map this event to the one in {label}. Accepted sessions and their speakers are pushed
            there; nothing is read back.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="accel-event-url">Event URL</Label>
            <Input
              id="accel-event-url"
              value={eventUrl}
              placeholder="my-conference-2026"
              autoComplete="off"
              onChange={(event) => setEventUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The slug from your {label} event address. Paste the whole address if that is easier;
              only the event part is stored.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="accel-event-id">Event ID (optional)</Label>
            <Input
              id="accel-event-id"
              value={remoteEventId}
              placeholder="12345"
              autoComplete="off"
              onChange={(event) => setRemoteEventId(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Needed by some {label} endpoints. Leave it blank if you do not have it; the connection
              works without it.
            </p>
          </div>

          {missing.length > 0 && (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Still missing after this: {missing.join(', ')}. That is deployment configuration
              rather than something set here, so saving this mapping is still worth doing.
            </p>
          )}

          {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={pending || eventUrl.trim() === ''}>
            {pending ? 'Connecting...' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
