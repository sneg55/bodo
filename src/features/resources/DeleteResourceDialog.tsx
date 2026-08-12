'use client'

// Destructive confirmation for deleting a resource page.
//
// `AlertDialog` rather than `Dialog`, per .claude/rules/ui-shadcn.md, and controlled rather
// than trigger-driven because the thing that opens it is a `DropdownMenuItem` in the row's
// overflow menu: nesting a trigger inside a menu item would have the menu's dismissal and
// the dialog's focus trap fighting each other.
//
// Its own file so ResourceRows.tsx stays inside the line limit.

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
import { Button } from '@/components/ui/button'

export type DeleteResourceDialogProps = {
  title: string
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteResourceDialog({
  title,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: DeleteResourceDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
          <AlertDialogDescription>
            The page and its portal link are removed. Speakers who have the URL will get a not found
            page. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant="destructive" disabled={pending} onClick={onConfirm} />}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
