'use client'

// Ref 25's `+ Add` button, which opens the Add Task sheet.
//
// **`Copy from...` IS GONE, and so is the footnote that apologised for it** (2026-08-10, on
// the owner's instruction). It was rendered permanently disabled with "Copying tasks from
// another event is not part of this build" underneath it, on the argument that a menu item
// saying plainly it is out of scope reads as a decision where a dead one reads as a bug, and
// that omitting it would lose the shape of the menu.
//
// That argument does not survive the result. Two of the menu's three rows were spent on a
// feature that does not exist: one greyed row an organizer cannot use, and one sentence
// telling them about a scope boundary they can do nothing with. The shape it preserved was
// the shape of a menu with one working item in it. Same call as Exhibitors & Sponsors on
// Event Settings (BUILD_SPEC 5.0b): a surface whose content is an apology for itself is an
// obstacle wearing familiarity's clothes. If copying tasks between events is ever built, it
// comes back as an item that works.
//
// **AND THEN THE MENU ITSELF WENT** (2026-08-11, same instruction). Removing `Copy from...`
// left ref 25's split button opening a one-row menu, so reaching Add Task cost a press to
// open a list and a press to pick the only thing on it. A menu that never offers a choice is
// not a menu, it is a confirmation step nobody asked for. The chevron went with it, because a
// chevron promises a list: this button opens the sheet on the first press. The label stays
// `+ Add` because that is ref 25's word and it is still true of a button that adds a task.
//
// If `Copy from...` is ever built, this goes back to being a `DropdownMenu` and the chevron
// comes back with it. That is the test for whether a menu belongs here: two things to choose
// between.

import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { TaskFormOption } from '@/features/tasks/admin-view'

import { AddTaskSheet } from './AddTaskSheet'

export function AddTaskButton({
  eventId,
  forms,
  disabled,
}: {
  eventId: string
  forms: readonly TaskFormOption[]
  /** A reviewer may read this surface. Only an admin may add to it. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <PlusIcon />
        Add
      </Button>

      <AddTaskSheet eventId={eventId} forms={forms} open={open} onOpenChange={setOpen} />
    </>
  )
}
