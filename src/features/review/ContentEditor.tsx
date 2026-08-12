'use client'

// The organizer's edit of a submission's title and abstract.
//
// Collapsed behind an Edit button rather than always open, because the detail page is
// read far more often than it is written and a page of live inputs invites an accidental
// save. Opening seeds from the props, so Cancel restores what the record holds without a
// re-read.
//
// The action returns the row it wrote and the local state is patched from THAT rather
// than from what was typed, the same optimistic shape `LookupList` and `TeamPanel` use. It
// matters here for a specific reason: the server trims the title, so a save of `" Talk "`
// leaves the field showing what was stored rather than what was keyed.
//
// A refusal only raises a toast and leaves the fields alone, so a title over the cap or a
// submission that has moved event does not silently discard what the organizer wrote.
//
// The abstract edits in the shared `RichTextEditor` and not a `Textarea`, because the
// registry types `description` as `wysiwyg` and the stored value is therefore markup: the
// plain box showed the seeded abstracts as `<p>...</p>` and made every save rewrite the
// whole body as escaped text. That primitive owns the `next/dynamic` boundary in front of
// TipTap, so ProseMirror is only fetched once somebody presses Edit.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ContentVersionHistory } from '@/features/review/ContentVersionHistory'
import { saveSubmissionContentAction } from '@/features/review/content-actions'
import { abstractRegistryLabel, TITLE_MAX_LENGTH } from '@/features/review/content-edit'

export function ContentEditor({
  eventId,
  submissionId,
  title: initialTitle,
  abstract: initialAbstract,
  abstractLabel,
}: {
  eventId: string
  submissionId: string
  title: string
  abstract: string
  /** The form's own label for the abstract question. Falls back to the registry's. */
  abstractLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [abstract, setAbstract] = useState(initialAbstract)
  const [saved, setSaved] = useState({ title: initialTitle, abstract: initialAbstract })
  // Bumped whenever the abstract is set from anywhere other than a keystroke. The rich
  // text body takes its content as `initialHtml` and is uncontrolled after mount, so a
  // Cancel, a trimmed save, or a restore would leave the old markup on screen unless the
  // editor is remounted. See the note in RichTextEditor.
  const [contentKey, setContentKey] = useState(0)
  const [pending, startTransition] = useTransition()

  function reseed(next: { title: string; abstract: string }): void {
    setTitle(next.title)
    setAbstract(next.abstract)
    setContentKey((previous) => previous + 1)
  }

  function cancel(): void {
    reseed(saved)
    setOpen(false)
  }

  function save(): void {
    startTransition(async () => {
      const result = await saveSubmissionContentAction({ eventId, submissionId, title, abstract })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const stored = { title: result.title, abstract: result.abstract }
      reseed(stored)
      setSaved(stored)
      setOpen(false)
      // Said plainly rather than always claiming success: an organizer who pressed Save
      // without changing anything has not written a revision, and telling them otherwise
      // would make the empty history below look broken.
      toast.success(result.changed === 0 ? 'No changes to save' : 'Saved successfully')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Content</CardTitle>
          <div className="flex items-center gap-2">
            {/* Beside Edit rather than inside the open form, because restoring is not a
                step of composing an edit: it is the other way of arriving at one, and it
                has to be reachable from the read state. Disabled mid-save because both
                writes land on the same record and would otherwise race. */}
            <ContentVersionHistory
              eventId={eventId}
              submissionId={submissionId}
              disabled={pending}
              onRestored={(next) => {
                reseed(next)
                setSaved(next)
                setOpen(false)
              }}
            />
            {open ? null : (
              <Button
                variant="outline"
                size="sm"
                // `hit-area-y`: 28px tall, and Version history is 8px to its left, so the
                // area grows vertically only.
                className="hit-area-y"
                onClick={() => setOpen(true)}
              >
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="content-title">Title</Label>
              <Input
                id="content-title"
                value={title}
                maxLength={TITLE_MAX_LENGTH}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            {/* Always rendered, including for a session that came through no form. That
                case used to render a Title box on its own, on the reasoning that there was
                nowhere to store the body, and it was wrong: `abstractField` resolves the
                manual key that Add Abstract already writes to. The seed's hand-entered
                keynote is exactly that record, and its abstract could not be edited. */}
            <RichTextEditor
              key={`abstract-${String(contentKey)}`}
              id="content-abstract"
              label={abstractLabel ?? abstractRegistryLabel()}
              value={abstract}
              onChange={setAbstract}
            />

            <div className="flex items-center gap-2">
              <Button disabled={pending} onClick={save}>
                Save
              </Button>
              <Button variant="outline" disabled={pending} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Edit this session&apos;s title and{' '}
            {(abstractLabel ?? abstractRegistryLabel()).toLowerCase()}. Every change is recorded
            below with who made it, and Version history puts an earlier value back.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
