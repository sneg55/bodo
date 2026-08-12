'use client'

// Read the email with its merge fields filled in, before saving it. SPK-14.
//
// The editor next door had SAVE and Close and nothing else, so `{{speaker.firstName}}` was a
// string in a textarea from the moment it was typed to the moment a speaker received it. An
// organizer rewriting an acceptance email was checking their prose and nothing else: not
// whether the greeting reads right, not whether their subject line interpolates, not whether
// the merge field they typed from memory is one that exists.
//
// It previews the UNSAVED text, which is the only order that helps: the point is to look
// before committing. Nothing is written by opening it.
//
// The same shape as the Notify preview (`abstracts/DecisionPreview.tsx`), deliberately, down
// to the sandboxed iframe and the "Your template" / "Built-in" badge: an organizer who has
// read one of these has read both, and the badge answers the same question in both places.
//
// Its own file rather than more of `AdminTemplateSheet.tsx`, which is the file-size rule
// doing what it is for: the sheet owns the fields and this owns the render, and neither
// needs to know how the other works.

import { EyeIcon } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { previewAdminTemplateAction } from '@/features/comms/template-actions'
import type { TemplatePreview } from '@/features/comms/template-preview'

export type TemplatePreviewDialogProps = {
  eventId: string
  /** The template being edited. Checked against the closed list inside the action. */
  templateKey: string
  /** The subject as it stands in the editor, saved or not. */
  subject: string
  /** The body as it stands in the editor, saved or not. */
  bodyMarkdown: string
}

export function TemplatePreviewDialog({
  eventId,
  templateKey,
  subject,
  bodyMarkdown,
}: TemplatePreviewDialogProps) {
  const [preview, setPreview] = useState<TemplatePreview | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  // Rendered on OPEN rather than on every keystroke. A render is two cached reads and a
  // markdown parse, and an organizer typing a paragraph does not want either fired per
  // character; opening the dialog is the moment they are asking the question.
  const load = (open: boolean) => {
    if (!open) return
    setPreview(undefined)
    setProblem(undefined)
    startTransition(async () => {
      const result = await previewAdminTemplateAction({
        eventId,
        key: templateKey,
        subject,
        bodyMarkdown,
      })
      if (!result.ok) {
        // The useful refusal: an unknown merge field comes back naming itself, so the fix
        // happens here rather than in an outbox row per recipient.
        setProblem(result.message)
        return
      }
      setPreview(result.preview)
    })
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <EyeIcon data-icon="inline-start" />
            Preview
          </Button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>What will be sent</DialogTitle>
          <DialogDescription>{describe(preview)}</DialogDescription>
        </DialogHeader>

        {pending ? <p className="text-sm text-muted-foreground">Rendering...</p> : null}
        {problem === undefined ? null : <p className="text-sm text-destructive">{problem}</p>}

        {preview === undefined ? null : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-pretty">{preview.subject}</span>
              {/* Which body produced this. Clearing the editor goes back to the built-in
                  email, so an organizer needs to know which of the two they are reading. */}
              <Badge variant="secondary">
                {preview.source === 'template' ? 'Your template' : 'Built-in'}
              </Badge>
            </div>
            {/* The rendered mail, in an iframe with no scripting and a null origin, because
                this is HTML assembled from an authored template and merge values. Rendering
                it into the admin document would give a template author script in an
                organizer's authenticated session. `sandbox` with no allow-scripts is what
                makes that impossible rather than merely unlikely. Same as the Notify
                preview, for the same reason. */}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-96 w-full rounded-md border bg-white"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Who the merge fields were resolved against, said plainly.
 *
 * The distinction is the whole reason a preview can be trusted: a real speaker off this
 * event's roster is a real name in the greeting, and an empty roster gets a stand-in that is
 * labelled as one. A preview that quietly invented a person would be indistinguishable from
 * a message already addressed to somebody.
 */
function describe(preview: TemplatePreview | undefined): string {
  if (preview === undefined) return 'Merge fields resolved against a speaker on this event.'
  if (preview.sampleRecipient) {
    return `Rendered for ${preview.toEmail}, a sample speaker: nobody is on this roster yet.`
  }
  return `Rendered for ${preview.toEmail}, the first speaker on this event. Session and task details are samples.`
}
