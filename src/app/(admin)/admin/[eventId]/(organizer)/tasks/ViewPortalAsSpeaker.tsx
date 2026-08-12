'use client'

// The impersonation entry control, one per row of the onboarding table.
//
// It belongs here rather than on a picker page of its own: this table already lists the
// event's accepted speakers with what each of them still owes, so the organizer looking at
// who is behind is exactly the person who wants to see what that speaker sees.
//
// A button and not a link, because entering is a state change (the session cookie is
// replaced) and it authorizes as `admin` on the event. On success the action redirects into
// the portal and this promise never resolves, so the only thing to handle is the failure: a
// reviewer, or a speaker who is no longer on the event.

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { startImpersonationAction } from '@/features/auth/impersonation-actions'

export function ViewPortalAsSpeaker({
  eventId,
  speakerId,
  name,
  disabled = false,
}: {
  eventId: string
  speakerId: string
  /** For the accessible name, so a screen reader hears which speaker this row is. */
  name: string
  /** A reviewer can read this board. Acting as somebody is an organizer's power. */
  disabled?: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      aria-label={`View Portal as ${name}`}
      onClick={() => {
        startTransition(async () => {
          const failure = await startImpersonationAction({ eventId, speakerId })
          if (failure !== undefined) toast.error(failure.message)
        })
      }}
    >
      View Portal
    </Button>
  )
}
