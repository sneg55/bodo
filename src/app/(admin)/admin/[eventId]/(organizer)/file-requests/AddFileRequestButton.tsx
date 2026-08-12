'use client'

// Ref 30's `+ Add` button, which opens the drawer on ref 31.
//
// A plain button and not a split dropdown, and the difference from the reference is transcribed
// rather than a shortcut: ref 25's Add control is captured OPEN, showing `Add Task` and
// `Copy from...`, while ref 30's is a closed `+ Add` with a chevron and no captured menu.
// Inventing a menu with one real item and one disabled item would be adding a control the
// reference does not show.
//
// Tasks has since arrived here from the other direction: `Copy from...` came out on 2026-08-10
// and the one-row menu behind its chevron on 2026-08-11, so `AddTaskButton` is a plain button
// too. This file was the argument for that all along.
//
// The chevron is kept, because ref 30 draws one, and it is decorative here: the button opens the
// drawer directly. That is the one thing on this control worth a second look, since a chevron
// promises a list and that broken promise is exactly what the Tasks menu was collapsed for.
// Left in place because the reference draws it, and raised as a parity question in
// `docs/parity/portal-tasks-forms.md` rather than deleted quietly. `PortalFormsBoard` copies
// this call from ref 26 and carries the same open question.

import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { AddFileRequestSheet } from './AddFileRequestSheet'

export function AddFileRequestButton({
  eventId,
  acceptedSpeakers,
  disabled,
}: {
  eventId: string
  /** Passed straight through: the drawer names the count on its Request switch. */
  acceptedSpeakers: number
  /** A reviewer may read this surface. Only an admin may add to it. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <PlusIcon />
        Add
        <ChevronDownIcon aria-hidden />
      </Button>

      <AddFileRequestSheet
        eventId={eventId}
        acceptedSpeakers={acceptedSpeakers}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
