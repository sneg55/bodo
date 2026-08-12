'use client'

// The editor behind `Customize` on any template row: the builder's "Admin notifications"
// panel (parity ref 15) and Settings > Email Templates.
//
// It lived in the form builder's route folder while that panel was its only caller. It moved
// here when the settings page began editing the same rows through the same action: two
// copies of a markdown editor over `EmailTemplates` is how the two surfaces would come to
// validate merge fields differently.
//
// A `Sheet`, matching every other right-hand editing drawer in this builder
// (.claude/rules/ui-shadcn.md, `FieldEditorSheet`).
//
// **The body is MARKDOWN and is edited as markdown, in a `Textarea` rather than the
// `RichTextEditor`.** That is a deliberate divergence from the builder's other body editors
// and the reason is the column: this row is stored in `EmailTemplates.bodyMarkdown`, which
// BUILD_SPEC 3 declares as markdown, and the sender converts it at resolve time
// (@/features/comms/markdown-email, which carries the full argument). TipTap would store
// HTML in a column named `bodyMarkdown`, and it is free to normalise and re-escape what it is
// given, which is how `{{speaker.firstName}}` comes back as markup that fails the render at
// send time. `Resources.bodyMarkdown` is authored the same way, in a Textarea, for the same
// reason. The submitter confirmation next door keeps its rich text editor because its column
// (`Forms.confirmationEmailHtml`) genuinely is HTML.
//
// This drawer DOES have a Save, unlike the submitter one, because these rows are event-scoped
// and are not part of the form draft: the editor's Save writes `Forms`, and this writes
// `EmailTemplates` through its own authorized action.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { TemplatePreviewDialog } from '@/features/comms/TemplatePreviewDialog'
import { saveAdminTemplateAction } from '@/features/comms/template-actions'
import type { AdminTemplateValue } from '@/features/comms/template-write'

export type AdminTemplateSheetProps = {
  eventId: string
  /** Undefined closes the drawer, which is what "no template is being edited" means. */
  template: AdminTemplateValue | undefined
  onSaved: (saved: AdminTemplateValue) => void
  onClose: () => void
}

export function AdminTemplateSheet({
  eventId,
  template,
  onSaved,
  onClose,
}: AdminTemplateSheetProps) {
  return (
    <Sheet
      open={template !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
        {template === undefined ? null : (
          <AdminTemplateForm
            // Keyed on the row, so switching rows resets the fields instead of carrying the
            // previous template's text into the next one.
            key={template.key}
            eventId={eventId}
            template={template}
            onSaved={onSaved}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function AdminTemplateForm({
  eventId,
  template,
  onSaved,
}: {
  eventId: string
  template: AdminTemplateValue
  onSaved: (saved: AdminTemplateValue) => void
}) {
  // Prefilled with the BUILT-IN default when nothing is stored, so an organizer can see and
  // edit the email that is actually being sent rather than guess at it from a blank box.
  const [subject, setSubject] = useState(
    template.subject === '' ? template.defaultSubject : template.subject,
  )
  const [body, setBody] = useState(
    template.bodyMarkdown === '' ? template.defaultBody : template.bodyMarkdown,
  )
  const [pending, start] = useTransition()

  function save(): void {
    start(async () => {
      const result = await saveAdminTemplateAction({
        eventId,
        key: template.key,
        subject,
        bodyMarkdown: body,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      onSaved(result.template)
      toast.success('Saved successfully')
    })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{template.title}</SheetTitle>
        <SheetDescription>{template.description}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`template-subject-${template.key}`}>Subject</Label>
          <Input
            id={`template-subject-${template.key}`}
            value={subject}
            placeholder={template.defaultSubject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`template-body-${template.key}`}>Body</Label>
          <Textarea
            id={`template-body-${template.key}`}
            className="min-h-56 font-mono text-xs"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="text-xs text-pretty text-muted-foreground">
            Markdown, with merge fields like {'{{submission.title}}'} and {'{{event.name}}'}. Clear
            the body to go back to the built-in email. Preview to see them resolved.
          </p>
        </div>
      </div>

      {/* Preview before Save, in that order on screen and in the workflow: the point of it is
          to read the merge fields resolved BEFORE committing the wording. It is handed the
          editor's current text rather than the stored row, so what is previewed is what is on
          screen. See TemplatePreviewDialog.tsx. */}
      <SheetFooter className="flex-row justify-end gap-2">
        <TemplatePreviewDialog
          eventId={eventId}
          templateKey={template.key}
          subject={subject}
          bodyMarkdown={body}
        />
        <Button onClick={save} disabled={pending}>
          Save
        </Button>
      </SheetFooter>
    </>
  )
}
