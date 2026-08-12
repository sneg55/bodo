'use client'

// Internal notes on a contact: the composer, and the attributed feed under it.
//
// This is the gap CRM-03 named. The profile had identity and history and no way to write
// anything down about a person, and the nearest thing to it, `Travel notes`, was writable
// only from inside the edit dialog and rendered on no read view at all, so a saved note was
// invisible unless somebody reopened the dialog it was typed into. Both halves are fixed:
// the logistics card next door now shows that column, and this panel is the org-level note
// it was being used as a substitute for.
//
// APPEND ONLY. There is no edit and no delete, which is `speaker-notes.ts`'s design rather
// than a missing control: the value of "said no for 2026, ask again in spring" is that it
// still says that in spring, and a feed an organizer can quietly rewrite records a decision
// nobody made.
//
// The composer clears itself on success and the new note arrives from the SERVER, not from
// client state. The action expired `speaker:{id}:notes` and its own response re-renders this
// route, so the feed below is what Airtable holds rather than an optimistic copy that would
// disagree with it the moment two organizers type at once.
//
// COPY IS AUTHORED. The parity report waives the whole CRM area, so there is nothing to
// transcribe; `Saved successfully` is the one string the parity docs do give for a write.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { addSpeakerNoteAction } from '@/features/crm/contact-actions'
import { checkNoteBody, NOTE_MAX_LENGTH, type SpeakerNoteRow } from '@/features/crm/notes'

export function SpeakerNotesPanel({
  speakerId,
  notes,
  canWrite,
}: {
  speakerId: string
  /** Newest first, already stamped on the server. */
  notes: readonly SpeakerNoteRow[]
  /**
   * False for a viewer who holds `admin` on none of this contact's events, which is a
   * reviewer. The composer is then absent rather than disabled: a disabled textarea
   * advertises a write that is not theirs and says nothing about why.
   */
  canWrite: boolean
}) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()

  const checked = checkNoteBody(body)

  // `startTransition(async () => ...)`, the correctness form: see `SpeakerTagEditor`. The
  // synchronous-scope variant leaves `pending` false in the same tick, and here that would
  // let a double-click append the same note twice to a log with no delete.
  const save = () => {
    if (!checked.ok) return
    startTransition(async () => {
      const result = await addSpeakerNoteAction({ speakerId, body: checked.body })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setBody('')
      toast.success('Saved successfully')
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Said once, on the card that could be mistaken for the other one. An organizer who
            cannot tell an internal note from Travel notes will eventually put a trip detail
            in a permanent log or a permanent decision in a field the speaker's own record
            carries around. */}
        <p className="text-xs text-muted-foreground">
          Only your team sees these. They follow the contact across every event and cannot be edited
          or deleted once saved.
        </p>

        {canWrite ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="speaker-note-body" className="sr-only">
              Add an internal note
            </Label>
            <Textarea
              id="speaker-note-body"
              value={body}
              rows={3}
              placeholder="Said no for 2026, ask again in spring."
              disabled={pending}
              onChange={(event) => {
                setBody(event.target.value)
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Counts down against the same cap the action enforces (`NOTE_MAX_LENGTH`),
                  so the composer and the server cannot disagree about what fits. */}
              <span className="text-xs text-muted-foreground tabular-nums">
                {`${String(body.trim().length)} / ${String(NOTE_MAX_LENGTH)}`}
              </span>
              {/* 28px tall and already wide, so `hit-area-y`. It reaches 6px up, and the
                  `Textarea` above it is `gap-2` (8px) away, so they do not meet. */}
              <Button
                size="sm"
                className="hit-area-y"
                disabled={pending || !checked.ok}
                onClick={save}
              >
                {pending ? 'Saving...' : 'Add Note'}
              </Button>
            </div>
            {/* The refusal reason, from the same function the action runs. Shown only once
                something has been typed, so an empty box is not an error state. */}
            {body.trim().length > 0 && !checked.ok ? (
              <p role="alert" className="text-sm text-destructive">
                {checked.reason}
              </p>
            ) : null}
          </div>
        ) : null}

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes on this contact yet.</p>
        ) : (
          <div className="flex flex-col gap-0">
            {notes.map((note, index) => (
              <div key={note.id}>
                {index === 0 ? null : <Separator className="my-3" />}
                {/* `whitespace-pre-line`, never `dangerouslySetInnerHTML`: this is organizer
                    input stored verbatim and it is not sanitized at the read boundary. */}
                <p className="text-pretty text-sm whitespace-pre-line">{note.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {`${note.authorName}${note.atText === '' ? '' : ` · ${note.atText}`}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
