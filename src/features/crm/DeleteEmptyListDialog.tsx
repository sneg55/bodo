'use client'

// The confirmation behind removing a list that stores no filters.
//
// Its own file because `SpeakerListPicker` reached the 300-line budget when the cleanup path
// was added, and this is the cleanest seam: everything here is presentational and controlled,
// so the picker keeps the state and the rules and hands this the row to confirm.
//
// `AlertDialog` and not `Dialog`, per .claude/rules/ui-shadcn.md: it is the destructive
// confirmation primitive. It earns its place rather than being ceremony, because an empty
// list is the one row an organizer CANNOT inspect before deleting: it can never be applied,
// so there is no way to look at what it matches first. The confirmation is where they are
// told what it is.
//
// Rendered by the picker OUTSIDE `DropdownMenuContent` deliberately. Inside, it would unmount
// with the menu the moment the item that opened it was clicked.

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
import type { SpeakerList } from '@/types/domain'

export type DeleteEmptyListDialogProps = {
  /** The row being confirmed, or `null` for closed. */
  list: SpeakerList | null
  pending: boolean
  onCancel: () => void
  onConfirm: (listId: string) => void
}

export function DeleteEmptyListDialog({
  list,
  pending,
  onCancel,
  onConfirm,
}: DeleteEmptyListDialogProps) {
  return (
    <AlertDialog
      open={list !== null}
      onOpenChange={(next: boolean) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete "${list?.name ?? ''}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            This list stores no filters, so it matches nothing and cannot be applied. Deleting it
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (list !== null) onConfirm(list.id)
            }}
          >
            Delete list
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
