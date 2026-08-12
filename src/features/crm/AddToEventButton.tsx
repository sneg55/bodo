'use client'

// `Add To Event`: the outward path from a CRM contact into one of the organizer's events.
//
// This is the gap CRM-10 named, and the direction is the whole point. Adding a contact from
// an event's ADD SPEAKER sheet already LINKED the existing record rather than creating a
// second one, so the model was right; what was missing was the other way round. An organizer
// looking at somebody they wanted at next year's conference had to leave the CRM, open that
// event's roster, and re-key a name and an address the profile in front of them was holding.
//
// A `DropdownMenu` rather than a `Dialog` with a picker in it, because there is exactly one
// decision to make and it is which of a handful of events. A modal would be a second click
// and a focus trap in front of a list of five items.
//
// The list is computed on the SERVER (`loadAddableEvents`): the viewer's `admin` events minus
// the ones this contact is already on. An empty list renders no button at all, which is the
// honest answer both for a reviewer, who cannot add anyone anywhere, and for an organizer
// whose every event this person is already on.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; `Saved successfully` is the one string the parity docs do give for a write.

import { CalendarPlusIcon } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { addSpeakerToEventAction } from '@/features/crm/contact-actions'
import type { AddableEvent } from '@/features/crm/profile-activity'

export function AddToEventButton({
  speakerId,
  events,
}: {
  speakerId: string
  /** The events they are NOT on yet. Nothing renders when this is empty. */
  events: readonly AddableEvent[]
}) {
  const [pending, startTransition] = useTransition()

  if (events.length === 0) return null

  // The correctness form of `startTransition`, per `SpeakerTagEditor`: the synchronous-scope
  // variant leaves `pending` false in the same tick, so the menu would stay live and two
  // clicks would issue two upserts of the same link.
  const add = (event: AddableEvent) => {
    startTransition(async () => {
      const result = await addSpeakerToEventAction({ speakerId, eventId: event.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Names the event, because the menu closes on click and a bare `Saved successfully`
      // would leave an organizer with five similarly named events unsure which one took it.
      toast.success('Saved successfully', { description: `Added to ${event.name}.` })
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={pending}>
            <CalendarPlusIcon data-icon="inline-start" />
            Add To Event
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {/* Grouped because `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and throws
            outside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add to</DropdownMenuLabel>
          {events.map((event) => (
            <DropdownMenuItem
              key={event.id}
              onClick={() => {
                add(event)
              }}
            >
              {event.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
