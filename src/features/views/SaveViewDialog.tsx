'use client'

// The name prompt behind "Save current view...".
//
// AUTHORED, not transcribed. The reference captured the Saved Views button and nothing
// behind it (docs/parity/abstracts-review.md, Ambiguities: "Saved Views dropdown contents
// and view creation flow"), so this is the smallest flow that can create a named view: a
// name, an optional "open this view by default", and the same name check the action runs.
//
// A centred `Dialog` rather than a `Sheet`, per .claude/rules/ui-shadcn.md: the drawer is
// reserved for the Preferences and Add Abstract surfaces the reference actually shows, and
// this is one field.

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
import { checkSavedViewName } from '@/features/views/saved-view-model'
import { SAVED_VIEW_NAME_MAX, type SavedView } from '@/types/saved-views'

export type SaveViewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** For the duplicate-name check, which the action repeats server side. */
  existing: readonly SavedView[]
  pending: boolean
  onSave: (input: { name: string; isDefault: boolean }) => void
}

export function SaveViewDialog({
  open,
  onOpenChange,
  existing,
  pending,
  onSave,
}: SaveViewDialogProps) {
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  // Shown only once the field has been typed in, so an untouched dialog is not scolding.
  const problem = name.length === 0 ? undefined : checkSavedViewName(name, existing)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (next) {
          setName('')
          setIsDefault(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save current view</DialogTitle>
          <DialogDescription>
            Stores the columns, sort and filters this list is showing now.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="saved-view-name">Name</Label>
          <Input
            id="saved-view-name"
            value={name}
            maxLength={SAVED_VIEW_NAME_MAX}
            placeholder="Enter view name..."
            onChange={(event) => setName(event.target.value)}
          />
          {problem === undefined ? null : <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="saved-view-default">Open this view by default</Label>
          <Switch id="saved-view-default" checked={isDefault} onCheckedChange={setIsDefault} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || name.trim().length === 0 || problem !== undefined}
            onClick={() => onSave({ name, isDefault })}
          >
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
