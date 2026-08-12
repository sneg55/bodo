'use client'

// The name prompt behind "Save current filters..." and "Rename list...".
//
// AUTHORED, not transcribed. The parity report waives the whole CRM area, so there is
// nothing to read a saved-list flow off; this is the smallest thing that can name a list:
// a name, a share switch, and the same name check the Server Action runs. It is modelled
// on `features/views/SaveViewDialog.tsx` deliberately, because a saved view and a saved
// list are the same gesture on two surfaces and an organizer should not have to learn two.
//
// A centred `Dialog` rather than a `Sheet`, per .claude/rules/ui-shadcn.md: the drawer is
// reserved for Preferences and Add Abstract, and this is one field.
//
// MOUNTED ONLY WHILE OPEN, which is why there is no effect resetting the fields. Both
// values are seeded from `editing` in `useState`, so opening the dialog on a different list
// is a fresh mount rather than a synchronised copy; syncing props into state inside an
// effect is a cascading render and the lint rule that forbids it is right.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { checkListName, SPEAKER_LIST_NAME_MAX } from '@/features/crm/lists'
import type { SpeakerList } from '@/types/domain'

export type SaveSpeakerListDialogProps = {
  onClose: () => void
  /**
   * For the duplicate-name check, which the action repeats server side.
   *
   * Must be every list the viewer may SEE, not the subset the picker can apply. The action
   * checks against the whole visible set, so narrowing it here let a list that stores no
   * filters keep reserving its name while appearing nowhere: the field showed no error, Save
   * was enabled, and the write came back "A list called that already exists." naming
   * something the organizer could not find.
   */
  existing: readonly SpeakerList[]
  /** The list being renamed, or `undefined` to create a new one. */
  editing?: SpeakerList
  /**
   * How many filters the dialog is about to store, for the one line of explanation.
   *
   * Never 0 on the create path: `Save current filters...` is disabled on an unfiltered
   * table, because a list storing no filters is not a list (`hasFilters` in lists.ts). The
   * dialog used to say "Stores the no filters this directory is showing now" and let Save
   * through on the name alone, which is how a zero-filter list got created in the first
   * place.
   */
  filterCount: number
  pending: boolean
  onSave: (input: { name: string; isShared: boolean }) => void
}

/** "1 filter" reads wrong as "1 filters", and the count is very often 1. */
function filterText(count: number): string {
  return `${String(count)} filter${count === 1 ? '' : 's'}`
}

export function SaveSpeakerListDialog({
  onClose,
  existing,
  editing,
  filterCount,
  pending,
  onSave,
}: SaveSpeakerListDialogProps) {
  const [name, setName] = useState(editing?.name ?? '')
  const [isShared, setIsShared] = useState(editing?.isShared ?? false)

  // Shown only once the field has been typed in, so an untouched dialog is not scolding.
  const check = name.length === 0 ? undefined : checkListName(name, existing, editing?.id)
  const problem = check === undefined || check.ok ? undefined : check.reason

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing === undefined ? 'Save current filters' : 'Rename list'}
          </DialogTitle>
          <DialogDescription>
            {editing === undefined
              ? `Stores the ${filterText(filterCount)} this directory is showing now. The list is re-evaluated on every read, so speakers who start matching appear in it.`
              : 'Renames the list. Use "Update with current filters" to change what it matches.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="speaker-list-name">Name</Label>
          <Input
            id="speaker-list-name"
            value={name}
            maxLength={SPEAKER_LIST_NAME_MAX}
            placeholder="Enter list name..."
            onChange={(event) => setName(event.target.value)}
          />
          {problem === undefined ? null : <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="speaker-list-shared">Share with your organizers</Label>
          <Switch id="speaker-list-shared" checked={isShared} onCheckedChange={setIsShared} />
        </div>
        {/* Said plainly, because "shared" on its own does not say who may change it and an
            organizer will assume the worst answer. */}
        <p className="text-xs text-muted-foreground">
          A shared list is visible to everyone in the CRM. Only you can rename or delete it.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || name.trim().length === 0 || problem !== undefined}
            onClick={() => onSave({ name, isShared })}
          >
            {editing === undefined ? 'Save list' : 'Rename list'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
