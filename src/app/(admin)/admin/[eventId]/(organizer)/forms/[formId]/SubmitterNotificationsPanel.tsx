'use client'

// The "Submitter notifications" panel on step 7 (parity ref 15), annotated "must have".
//
// One row, `Submission Confirmation`, with the enable toggle and a `Customize` button. The
// button is the parity fix this file exists for: the editor used to be an inline
// `RichTextEditor` that appeared under the row whenever the toggle was on, and the reference
// puts it behind `Customize` (with a settings-sliders icon) instead.
//
// WHERE THE VALUE LIVES IS UNCHANGED, deliberately. The toggle is `Forms.confirmationEmailEnabled`
// and the body is `Forms.confirmationEmailHtml`, both on the form draft, both saved by the
// editor's one Save, and both already read by the CFP path. This panel is NOT `EmailTemplates`
// and never was: the parity doc records that correction. Moving the body into that table to
// match the panel below it would change what a shipped column means for the sake of symmetry.
//
// So the drawer has no Save of its own. The value is draft state like every other control in
// this builder, and a second save button here would imply a second write that does not exist.
//
// A `Sheet` and not a `Dialog`, per .claude/rules/ui-shadcn.md: every right-hand editing
// drawer in this product is a Sheet, and the builder already opens one for a question
// (`FieldEditorSheet`). A rich text editor needs the height a drawer has and a centred modal
// does not.

import { MailIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useState } from 'react'

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

import { NotificationTemplateRow } from './NotificationTemplateRow'

export type SubmitterNotificationsPanelProps = {
  enabled: boolean
  html: string
  onEnabledChange: (enabled: boolean) => void
  onHtmlChange: (html: string) => void
}

export function SubmitterNotificationsPanel({
  enabled,
  html,
  onEnabledChange,
  onHtmlChange,
}: SubmitterNotificationsPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="gap-3 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Submitter notifications</h3>
        <span className="text-xs text-muted-foreground">1 template</span>
      </div>

      <NotificationTemplateRow
        icon={<MailIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        title={<Label htmlFor="confirmation-enabled">Submission Confirmation</Label>}
        description="Email sent to the submitter after a successful submission"
        controls={
          <>
            <Switch id="confirmation-enabled" checked={enabled} onCheckedChange={onEnabledChange} />
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <SlidersHorizontalIcon />
              Customize
            </Button>
          </>
        }
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg!">
          <SheetHeader>
            <SheetTitle>Submission Confirmation</SheetTitle>
            <SheetDescription>
              Email sent to the submitter after a successful submission
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 pb-6">
            {/* Mounted only while the drawer is open, which is also why the editor is
                behind a button at all: TipTap is dynamically imported at this component
                (RichTextEditor), so a step that opens no drawer never loads it. */}
            <RichTextEditor
              id="confirmation-html"
              label="Confirmation email body"
              value={html}
              help="The portal access link is appended by the sender, so it does not need to be written here."
              onChange={onHtmlChange}
            />
            {enabled ? null : (
              <p className="text-xs text-muted-foreground">
                This email is switched off, so nothing is sent until the toggle is on.
              </p>
            )}
          </div>

          <SheetFooter>
            <SheetClose
              // The drawer edits draft state, so there is nothing to save here and nothing
              // to discard: the editor's Save writes this along with the rest of the form.
              render={<Button variant="outline">Done</Button>}
            />
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  )
}
