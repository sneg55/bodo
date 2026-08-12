'use client'

// The comment thread on one deliverable. CNT-05.
//
// In a popover on the row rather than a column of its own, because a thread is prose and a
// table cell is not: the count belongs in the row, the conversation belongs behind it.
//
// Append only, which the UI states rather than merely enforcing. The value of "re-export
// without the speaker notes, 3 March" is that it still says that in April, so there is no
// edit and no delete, and a reader can trust what they see for that reason.
//
// ONE THREAD PER DELIVERABLE, so every row of a version group shows the same conversation
// and the same count. It used to be one thread per upload, which meant this table showed
// "3" on the latest row and "1" on the v1 row for what was one exchange, and the speaker's
// portal showed nothing at all once they had answered. `onVersion` keeps what the split
// counts were really carrying: which upload each note was written about.

import { MessageSquareIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { addFileCommentAction } from '@/features/files/comment-actions'
import type { FileCommentRow } from '@/features/files/reads'

export function FileCommentsPopover({
  eventId,
  fileId,
  filename,
  groupSize,
  comments,
}: {
  eventId: string
  fileId: string
  filename: string
  /** How many uploads share this thread. 1 hides the version markers as noise. */
  groupSize: number
  comments: readonly FileCommentRow[]
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const result = await addFileCommentAction({ eventId, fileId, body })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setBody('')
      toast.success('Comment added')
      // The write expired the event's files tag, so the next server render has the
      // thread. This is what makes one happen.
      router.refresh()
    })
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="hit-area-y gap-1.5">
            {/* Optical padding: the attribute is what the Button's cva keys its leading
                inset off, so the icon is not padded as if it were text. */}
            <MessageSquareIcon className="size-3.5" data-icon="inline-start" />
            {comments.length === 0 ? 'Comment' : String(comments.length)}
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-96 flex-col gap-3">
        <p className="truncate text-xs text-muted-foreground">
          {filename}
          {/* Said out loud, because the count on every row of a group is now the same
              number and an organizer would otherwise read that as a duplicate. */}
          {groupSize > 1 ? ` - one thread across all ${String(groupSize)} versions` : ''}
        </p>

        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comments yet. Anything written here is kept, so a speaker can be told what to change
            and the reason survives the next upload.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto">
            {comments.map((comment) => (
              <li key={comment.id} className="flex flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  {/* Who and when, which is what the item asks for and what makes the
                      thread usable a month later. */}
                  <span className="font-medium text-foreground">{comment.authorName}</span>
                  <span className="flex items-baseline gap-1.5">
                    {/* Which upload it was about. The file link on the row is what carries
                        this, and it is the reason the comments are still stored per file. */}
                    {groupSize > 1 ? <span>on v{String(comment.onVersion)}</span> : null}
                    <span className="tabular-nums">{comment.atText}</span>
                  </span>
                </span>
                <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <Textarea
          rows={3}
          value={body}
          placeholder="Ask for a change, or note what was agreed."
          onChange={(event) => setBody(event.target.value)}
        />
        <Button
          size="sm"
          className="hit-area-y"
          disabled={pending || body.trim() === ''}
          onClick={submit}
        >
          Add comment
        </Button>
      </PopoverContent>
    </Popover>
  )
}
