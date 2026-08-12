'use client'

// The bulk bar's entry point into the composer. SPK-13.
//
// A thin shell on purpose: it owns the trigger and the drawer, and the composer inside it owns
// every field. That split is what lets the composer be MOUNTED FRESH each time the drawer
// opens, which is the behaviour an organizer expects from a compose window: the subject, the
// body and the preview from the last send are gone, rather than waiting there to be sent to a
// different selection by accident.
//
// It sits beside `Invite to portal` rather than replacing it. The invitation is a fixed
// transactional message with its own idempotency and its own `invitedAt` stamp on the roster,
// and collapsing it into a general composer would lose both.

import { MailPlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { BulkEmailComposer } from '@/features/comms/BulkEmailComposer'

export function BulkEmailButton({
  eventId,
  speakerIds,
  onSent,
}: {
  eventId: string
  /** Whoever is ticked, and already narrowed to what the roster is SHOWING. */
  speakerIds: readonly string[]
  onSent: () => void
}) {
  const [open, setOpen] = useState(false)
  const count = speakerIds.length

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="hit-area-y" disabled={count === 0}>
            <MailPlusIcon data-icon="inline-start" />
            Compose email
            {count === 0 ? null : ` (${String(count)})`}
          </Button>
        }
      />
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl!">
        {open ? (
          <BulkEmailComposer
            eventId={eventId}
            speakerIds={speakerIds}
            onSent={() => {
              setOpen(false)
              onSent()
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
