'use client'

// Read the decision email before pressing Notify. CFP-14.
//
// Notify is the irreversible half: it commits the status, stamps `notifiedAt` and queues
// mail nobody can recall. Until now an organizer did all that to a body they had never
// seen, and found out what went out by checking a mailbox afterwards.
//
// It previews ONE submission rather than the whole selection, and specifically the first
// one ticked. Forty previews is not a review, it is a scroll: the body is the same template
// for every accept, so what an organizer is actually checking is the template, the merge
// fields resolving, and the subject line. One rendered example answers all three.
//
// Loaded on OPEN rather than with the row, because most Notify presses do not want it and a
// render per selected row would be forty template reads nobody asked for.
//
// The trigger stays ENABLED for a row the action will refuse, and that is a decision rather
// than an oversight. The refusal is the useful answer: "that submission is not staged for a
// decision, so nothing would be sent" tells an organizer why nothing would go out and what
// to do about it, where a greyed-out button tells them nothing. It also cannot be computed
// here without threading every selected row's status through the bulk bar, and the answer
// would still be the action's to give. It used to crash the page instead of being shown,
// which is what made the enabled trigger look like the fault: see decision-preview.ts.

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
import {
  type DecisionPreview as Preview,
  previewDecisionEmailAction,
} from '@/features/submissions/decision-preview'

export function DecisionPreview({
  eventId,
  submissionIds,
}: {
  eventId: string
  submissionIds: readonly string[]
}) {
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  const load = (open: boolean) => {
    if (!open) return
    const submissionId = submissionIds.at(0)
    if (submissionId === undefined) return

    setPreview(undefined)
    setProblem(undefined)
    startTransition(async () => {
      const result = await previewDecisionEmailAction({ eventId, submissionId })
      if (!result.ok) {
        setProblem(result.message)
        return
      }
      setPreview(result)
    })
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={submissionIds.length === 0}>
            <EyeIcon />
            Preview email
          </Button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>What will be sent</DialogTitle>
          <DialogDescription>
            {preview === undefined
              ? submissionIds.length > 1
                ? 'Rendered from the first submission you selected.'
                : 'Rendered from the selected submission.'
              : `Rendered for ${preview.toEmail}${
                  preview.recipientCount > 1
                    ? `, one of ${String(preview.recipientCount)} recipients on this submission`
                    : ''
                }.`}
          </DialogDescription>
        </DialogHeader>

        {pending ? <p className="text-sm text-muted-foreground">Rendering...</p> : null}
        {problem === undefined ? null : <p className="text-sm text-destructive">{problem}</p>}

        {preview === undefined ? null : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{preview.subject}</span>
              {/* Which body produced this. An organizer who wrote a template needs to know
                  it is the one being used, and one who did not needs to know they are
                  looking at the built-in copy rather than their own. */}
              <Badge variant="secondary">
                {preview.source === 'template' ? 'Your template' : 'Built-in'}
              </Badge>
            </div>
            {/* The rendered mail, in an iframe with no scripting and a null origin, because
                this is HTML assembled from a stored template and merge values. Rendering it
                into the admin document would give a template author script in an
                organizer's authenticated session. `sandbox` with no allow-scripts is what
                makes that impossible rather than merely unlikely. */}
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
