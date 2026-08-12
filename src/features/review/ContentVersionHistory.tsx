'use client'

// Putting a prior version of a session's title or abstract back. CNT-11.
//
// The read-only Change history on the detail page below already answered the attribution
// half: who changed what, from what, when. It had no way to act on any of it, so a chair
// who wanted the previous abstract back had to select the Before text and retype it.
//
// This is that list again, in a `Dialog`, with a Restore on each entry. It reads its own
// copy through an action on open rather than taking the page's list as a prop, and that is
// deliberate: the page's copy was server-rendered before any save in this session, so
// after two edits it is a version behind, and a Restore built off a stale list would put
// back a value the organizer cannot see on screen.
//
// Restore APPENDS. It saves the old value through the same path Save uses, so the write
// is validated identically and leaves a new history row naming who restored it. Nothing
// is deleted and no row is amended. See `restorePayload` for why rewinding was rejected.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ScrollPanel } from '@/components/primitives/ScrollPanel'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { htmlToText } from '@/features/portal/answers-view'
import {
  listSubmissionRevisionsAction,
  restoreSubmissionContentAction,
} from '@/features/review/content-actions'
import { formatRevisionStamp } from '@/features/review/content-edit'
import type { ContentRevision } from '@/services/airtable/revisions'

export function ContentVersionHistory({
  eventId,
  submissionId,
  disabled,
  onRestored,
}: {
  eventId: string
  submissionId: string
  /** True while the editor itself is mid-save, so the two writes cannot interleave. */
  disabled: boolean
  /** Patches the editor's fields from what the restore actually stored. */
  onRestored: (content: { title: string; abstract: string }) => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [revisions, setRevisions] = useState<readonly ContentRevision[]>()
  const [confirming, setConfirming] = useState<ContentRevision>()
  const [pending, startTransition] = useTransition()

  function openChanged(next: boolean): void {
    setOpen(next)
    if (!next) return

    // Cleared first, so a second opening shows the skeleton rather than the list from
    // before the last save while the fresh one is in flight.
    setRevisions(undefined)
    startTransition(async () => {
      const result = await listSubmissionRevisionsAction({ eventId, submissionId })
      if (!result.ok) {
        toast.error(result.message)
        setOpen(false)
        return
      }
      setRevisions(result.revisions)
    })
  }

  function restore(revision: ContentRevision): void {
    startTransition(async () => {
      const result = await restoreSubmissionContentAction({
        eventId,
        submissionId,
        revisionId: revision.id,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setConfirming(undefined)
      setOpen(false)
      onRestored({ title: result.title, abstract: result.abstract })
      // The Change history section on the page is a server render, and the restore just
      // appended a row to it. Without this the organizer is told it worked and the panel
      // underneath still shows the old list until they reload.
      router.refresh()
      toast.success(
        result.changed === 0 ? 'That version is already the current one' : 'Saved successfully',
      )
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={openChanged}>
        <DialogTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              // 28px tall beside Edit at `gap-2`, so the area grows vertically only.
              className="hit-area-y"
              disabled={disabled}
            >
              Version history
            </Button>
          }
        />
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>
              Restoring saves the earlier value again. It is recorded as a new change rather than
              erasing the ones after it.
            </DialogDescription>
          </DialogHeader>

          {revisions === undefined ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No edits recorded yet.</p>
          ) : (
            <ScrollPanel className="max-h-[24rem] pr-3">
              <ul className="flex flex-col gap-4">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">{revision.fieldLabel}</span>{' '}
                        changed by {revision.editorName} on {formatRevisionStamp(revision.at)}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        // 28px tall at the top of a list item; the revisions are 16px apart
                        // and the only other control is one list item away, so 40 clears.
                        className="hit-area-y"
                        disabled={pending}
                        onClick={() => setConfirming(revision)}
                      >
                        Restore
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Value label="Before" text={revision.previousValue} />
                      <Value label="After" text={revision.newValue} />
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollPanel>
          )}
        </DialogContent>
      </Dialog>

      {/* Controlled and outside the Dialog above: the confirmation outlives the list it
          was opened from, because a successful restore closes that list. */}
      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(next) => {
          if (!next) setConfirming(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore this {confirming?.fieldLabel.toLowerCase()}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The {confirming?.fieldLabel.toLowerCase()} goes back to what it was before{' '}
              {confirming?.editorName} changed it on {formatRevisionStamp(confirming?.at ?? '')}.
              What is there now is replaced, and both values stay in the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="ghost" disabled={pending} />}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              render={
                <Button
                  disabled={pending}
                  onClick={() => {
                    if (confirming !== undefined) restore(confirming)
                  }}
                />
              }
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * The Before/After pair, as prose.
 *
 * Flattened through `htmlToText` rather than shown raw, and never through
 * `dangerouslySetInnerHTML`: the abstract is a `wysiwyg` answer, so a stored value is
 * markup, and a chooser that shows `<p>Sharding, caching...</p>` is asking somebody to
 * pick a version by reading tags. The value RESTORED is the stored one either way; this
 * only decides what the row looks like.
 */
function Value({ label, text }: { label: string; text: string }) {
  const prose = htmlToText(text)
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {/* An emptied field is a fact worth showing rather than a blank box. */}
      <p className="line-clamp-6 whitespace-pre-wrap break-words">
        {prose === '' ? <span className="text-muted-foreground">(empty)</span> : prose}
      </p>
    </div>
  )
}
