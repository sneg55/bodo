'use client'

// One form card (parity ref 05): count bubble, name, Open/Closed badge, chips, overflow
// menu, then the stat line and the deadline.
//
// The overflow menu carries publish and unpublish, which the screenshots do not show. It
// is here rather than nowhere because the public page renders only a published form, so
// without it a form built in this UI could never be reached by a speaker. See the note in
// the editor header for the same reasoning.
//
// Duplicate and Delete are here for a plainer reason: without them a form created by mistake
// stayed on this list forever, since nothing else in the product can remove one. Ref 28's
// portal form card carries exactly this pair and PortalList is where the confirmation shape
// comes from. Delete refuses on the server while the form has submissions, and the dialog
// says so before it is pressed rather than only reporting the refusal afterwards.

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { setFormStatusAction } from '@/features/forms/builder/actions'
import type { FormCardRow } from '@/features/forms/builder/list-view'
import { deleteFormAction, duplicateFormAction } from '@/features/forms/builder/manage-actions'

const STATE_LABELS: ReadonlyMap<FormCardRow['state'], string> = new Map([
  ['draft', 'Draft'],
  ['open', 'Open'],
  ['closed', 'Closed'],
])

/**
 * Why this form cannot be deleted, or `undefined` when it can.
 *
 * Both refusals the ACTION makes, stated here so the dialog explains itself and its confirm
 * button is dead rather than the organizer learning by pressing it. The action still checks
 * both for itself: this is the same rule rendered twice, not the rule itself.
 *
 * `state !== 'draft'` covers open and closed alike, because both are `status: published` on
 * the record and a closed form can be reopened. Deleting a published form is refused even
 * with no submissions, because the count is read before the delete and Airtable has no
 * transaction, so a speaker mid-submit lands a row that survives with its form gone.
 */
function deleteBlocker(row: FormCardRow): string | undefined {
  if (row.state !== 'draft') {
    return 'This form is published, so a speaker could be filling it in right now. Unpublish it first, then delete it.'
  }
  const carried = row.submissions + row.drafts
  if (carried > 0) {
    return `This form cannot be deleted: ${String(carried)} submissions came through it and would be left with no record of what was asked.`
  }
  return undefined
}

export type FormCardProps = { row: FormCardRow; eventId: string; eventSlug: string }

export function FormCard({ row, eventId, eventSlug }: FormCardProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const editHref = `/admin/${eventId}/forms/${row.id}`
  const publicHref = `/submit/${eventSlug}/${row.publicId}`

  function setStatus(status: 'draft' | 'published'): void {
    start(async () => {
      const result = await setFormStatusAction({ eventId, formId: row.id, status })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(status === 'published' ? 'Form published' : 'Form unpublished')
      router.refresh()
    })
  }

  function duplicate(): void {
    start(async () => {
      const result = await duplicateFormAction({ eventId, formId: row.id })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Straight into the copy's editor, the way Create Form goes into a new one: the copy
      // is a draft and renaming it is the first thing anybody does with it.
      toast.success('Saved successfully', { description: `${row.name} was duplicated.` })
      router.push(`/admin/${eventId}/forms/${result.formId}`)
    })
  }

  function remove(): void {
    start(async () => {
      const result = await deleteFormAction({ eventId, formId: row.id })
      setConfirming(false)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully', { description: `${row.name} was deleted.` })
      router.refresh()
    })
  }

  return (
    <li>
      <Card className="gap-2 p-3">
        <div className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
            {row.pending}
          </span>

          <Link href={editHref} className="min-w-0 truncate font-medium hover:underline">
            {row.name}
          </Link>

          <Badge variant={row.state === 'open' ? 'default' : 'secondary'}>
            {STATE_LABELS.get(row.state)}
          </Badge>
          {row.participantsEnabled ? (
            <Badge variant="outline">
              {row.entityKind === 'sessions'
                ? 'Sessions & Participants'
                : 'Abstracts & Participants'}
            </Badge>
          ) : null}
          <Badge variant="outline">V2</Badge>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" disabled={pending} />}
            >
              <MoreHorizontalIcon />
              <span className="sr-only">{`Options for ${row.name}`}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link href={editHref} />}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                render={<Link href={publicHref} target="_blank" rel="noreferrer" />}
                disabled={row.state === 'draft'}
              >
                View Form
              </DropdownMenuItem>
              <DropdownMenuItem onClick={duplicate}>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              {row.state === 'draft' ? (
                <DropdownMenuItem onClick={() => setStatus('published')}>Publish</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setStatus('draft')}>Unpublish</DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="text-xs text-muted-foreground">
          {`${String(row.submissions)} submissions · ${String(row.drafts)} drafts`}
          {row.closesLine === undefined ? '' : ` · ${row.closesLine}`}
        </p>
      </Card>

      <AlertDialog
        open={confirming}
        onOpenChange={(next: boolean) => {
          if (!next) setConfirming(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocker(row) ??
                'Its public link stops working immediately. Nothing has been submitted through it, so nothing else is affected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" />}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button
                  variant="destructive"
                  disabled={pending || deleteBlocker(row) !== undefined}
                />
              }
              onClick={remove}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
