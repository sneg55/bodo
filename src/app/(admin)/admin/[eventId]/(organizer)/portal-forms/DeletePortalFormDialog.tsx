'use client'

// The confirmation behind Delete in the portal form editor.
//
// `AlertDialog` and not `Dialog`, per .claude/rules/ui-shadcn.md, which names it as the
// destructive confirmation primitive. The button had none: one click on a `destructive`
// Button deleted the form outright, with no undo and nothing between an organizer's misclick
// and a record gone. The CFP side already confirms its own form delete (`FormCard`), so this
// is that convention reaching the control that was missing it.
//
// Its own file for the reason `DeleteEmptyListDialog` gives: `PortalFormEditor` is at the
// 300-line budget, and this is the clean seam, since everything here is presentational and
// controlled. The editor keeps the state and owns the action.
//
// What the description does NOT do is name the task count that would block the delete, the
// way `FormCard`'s dialog names its blockers. That count is not on this screen and reading it
// to render a sentence would put a task list behind opening a dialog; `deletePortalFormAction`
// refuses an assigned form and its message reaches the organizer as an error toast.

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

export type DeletePortalFormDialogProps = {
  open: boolean
  /** The form's internal name, which is what the organizer searches the list by. */
  name: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeletePortalFormDialog({
  open,
  name,
  pending,
  onOpenChange,
  onConfirm,
}: DeletePortalFormDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Delete "${name}"?`}</AlertDialogTitle>
          <AlertDialogDescription>
            Its questions go with it, and this cannot be undone. A form that is already assigned
            through a task cannot be deleted at all: delete the task first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            Delete form
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
