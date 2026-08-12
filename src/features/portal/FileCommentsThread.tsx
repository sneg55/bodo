'use client'

// The speaker's view of a file's comment thread, and their reply. CNT-05.
//
// The organizer's side shipped first and this did not, so the note asking for a corrected
// export sat in a popover the person who had to act on it could not open. A one-sided thread
// is worse than none: the organizer believes the message was delivered.
//
// Loaded on OPEN rather than with the row. Most speakers have no comments on most files, and
// a read per delivered file on every portal render would be a request per row for an empty
// list.

import { MessageSquareIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  addOwnFileCommentAction,
  listOwnFileCommentsAction,
  type PortalFileComment,
} from '@/features/portal/file-comment-actions'

export function FileCommentsThread({ fileId, label }: { fileId: string; label: string }) {
  const [comments, setComments] = useState<readonly PortalFileComment[] | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const load = (open: boolean) => {
    if (!open) return
    setProblem(undefined)
    startTransition(async () => {
      const result = await listOwnFileCommentsAction({ fileId })
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      setComments(result.comments)
    })
  }

  const send = () => {
    setProblem(undefined)
    startTransition(async () => {
      const result = await addOwnFileCommentAction({ fileId, body: draft })
      if (!result.ok) {
        setProblem(result.message)
        toast.error(result.message)
        return
      }
      setDraft('')
      toast.success('Comment added')
      // Re-read rather than appending what was typed. The server trims, and the author name
      // is resolved there, so the row the thread shows is the row that was stored.
      const reread = await listOwnFileCommentsAction({ fileId })
      if (reread.ok) setComments(reread.comments)
    })
  }

  return (
    <Popover onOpenChange={load}>
      <PopoverTrigger
        render={
          // 28px and already wide. It grows 6px each way, which is inside the 8px this row
          // has to its neighbours in both of the places it renders: a file row in
          // `SubmissionFiles`, where the `Download` beside it is 12px off horizontally and
          // the next row's control is 34px below, and a request row in
          // `RequestedFilesPanel`, where the version list above it is 15px up.
          <Button
            variant="ghost"
            size="sm"
            className="hit-area-y"
            aria-label={`Comments on ${label}`}
          >
            <MessageSquareIcon data-icon="inline-start" />
            Comments
          </Button>
        }
      />
      <PopoverContent className="w-80 space-y-3">
        {pending && comments === undefined ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : null}
        {problem === undefined ? null : <p className="text-sm text-destructive">{problem}</p>}

        {comments === undefined || comments.length === 0 ? (
          <p className="text-pretty text-sm text-muted-foreground">
            No comments yet. The organizers will leave notes here if they need a change.
          </p>
        ) : (
          <ul className="max-h-56 space-y-3 overflow-y-auto">
            {comments.map((comment) => (
              <li key={comment.id} className="space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  {comment.authorName} · {new Date(comment.at).toLocaleDateString()}
                </p>
                <p className="text-pretty text-sm whitespace-pre-line">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <Textarea
            aria-label="Add a comment"
            placeholder="Reply to the organizers..."
            rows={3}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
            }}
          />
          {/* 28px, 8px under the textarea, so the band's 6px stops 2px short of it. */}
          <Button
            size="sm"
            className="hit-area-y"
            disabled={pending || draft.trim() === ''}
            onClick={send}
          >
            {pending ? 'Sending...' : 'Add comment'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
